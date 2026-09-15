import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { codexSpawnCommand } from "./cli-resolver";

type RpcResponse = { id?: number; result?: unknown; error?: { code?: number; message?: string }; method?: string; params?: unknown };
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

export interface AppServerClientOptions { executable: string; timeoutMs?: number; spawnProcess?: typeof spawn }

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stopped = false;
  private readonly timeoutMs: number;
  constructor(private readonly options: AppServerClientOptions) { super(); this.timeoutMs = options.timeoutMs ?? 30_000; }

  async start(): Promise<void> {
    if (this.child) return;
    const resolved = codexSpawnCommand(this.options.executable);
    const child = (this.options.spawnProcess ?? spawn)(resolved.command, resolved.args, {
      shell: resolved.shell, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => this.emit("diagnostic", String(chunk)));
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      this.child = undefined;
      if (!this.stopped) this.failAll(new Error(`Codex App Server exited unexpectedly (${code ?? signal ?? "unknown"})`));
      this.emit("exit", code, signal);
    });
    await this.request("initialize", { clientInfo: { name: "codex-visual-instructions", version: "0.1.0" }, capabilities: {} });
    this.notify("initialized", {});
    if (process.platform === "win32") await this.prepareWindowsSandbox();
  }

  private async prepareWindowsSandbox(): Promise<void> {
    let settle: ((error?: Error) => void) | undefined;
    let timer: NodeJS.Timeout | undefined;
    const completion = new Promise<void>((resolve, reject) => {
      settle = (error) => error ? reject(error) : resolve();
    });
    const onNotification = (method: string, params: any): void => {
      if (method !== "windowsSandbox/setupCompleted" || params?.mode !== "unelevated") return;
      if (params.success) settle?.();
      else settle?.(new Error(`Windows sandbox setup failed${params?.error ? `: ${String(params.error)}` : ""}`));
    };
    this.on("notification", onNotification);
    try {
      const result = await this.request("windowsSandbox/setupStart", { mode: "unelevated" });
      if (result?.started === false) return;
      await Promise.race([
        completion,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Windows sandbox setup timed out")), this.timeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.off("notification", onNotification);
    }
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }
  notify(method: string, params: unknown): void { this.write({ jsonrpc: "2.0", method, params }); }
  async stop(): Promise<void> {
    this.stopped = true; this.failAll(new Error("Codex App Server stopped"));
    const child = this.child; this.child = undefined;
    if (!child || child.killed) return;
    child.kill();
    await new Promise<void>((resolve) => { child.once("exit", () => resolve()); setTimeout(resolve, 1_000).unref(); });
  }
  private write(value: unknown): void {
    if (!this.child?.stdin.writable) throw new Error("Codex App Server is not running");
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }
  private handleLine(line: string): void {
    let message: RpcResponse;
    try { message = JSON.parse(line) as RpcResponse; } catch { this.emit("protocol-error", new Error("Malformed JSON from Codex App Server")); return; }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? `JSON-RPC error ${message.error.code ?? "unknown"}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.emit("notification", message.method, message.params);
  }
  private failAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.emit("failure", error);
  }
}
