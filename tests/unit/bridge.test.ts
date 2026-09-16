import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ReviewSession } from "../../src";
import { AppServerClient, ReviewTaskManager, resolveCodexCli, startBridge, validateReviewSession, validateWorkspace, workerPrompt } from "../../src/bridge";

const session = (): ReviewSession => ({
  version: 1, sessionId: "review-1", route: "/", createdAt: "now", status: "ready", confirmedAt: "later",
  viewport: { width: 1000, height: 800, devicePixelRatio: 1, preset: "desktop" },
  summary: { total: 1, pending: 1, resolved: 0, byOperation: { hide: 1 } },
  annotations: [{ id: "a", target: { tagName: "DIV" }, operation: { type: "hide", intent: "not-visible" }, intent: "visibility", comment: "", precision: "intent-only", viewport: { width: 1000, height: 800, devicePixelRatio: 1, preset: "desktop" }, applyScope: "current-viewport", risk: "low", verificationRequired: false, implementationRequirements: [], resolved: false, createdAt: "now" }],
  implementationInstruction: "Visual specification",
});

describe("bridge core", () => {
  it("resolves an explicit CLI and PATH candidate without versioned paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vi-cli-")); const name = process.platform === "win32" ? "codex.cmd" : "codex";
    const executable = join(directory, name); await writeFile(executable, "");
    await expect(resolveCodexCli(executable, { PATH: "" })).resolves.toBe(executable);
    await expect(resolveCodexCli(undefined, { PATH: directory })).resolves.toBe(executable);
  });

  it("discovers the current Windows Desktop CLI without fixing a versioned path", async () => {
    const localAppData = await mkdtemp(join(tmpdir(), "vi-local-app-data-"));
    const bin = join(localAppData, "OpenAI", "Codex", "bin", "current-build");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(bin, { recursive: true }));
    const executable = join(bin, "codex.exe"); await writeFile(executable, "");
    await expect(resolveCodexCli(undefined, { PATH: "", LOCALAPPDATA: localAppData }, "win32")).resolves.toBe(executable);
  });

  it("initializes, correlates requests, streams notifications, handles malformed JSON and cleans up", async () => {
    const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.killed = false;
    child.kill = vi.fn(() => { child.killed = true; queueMicrotask(() => child.emit("exit", 0, null)); return true; });
    child.stdin.on("data", (chunk: Buffer) => {
      for (const line of String(chunk).trim().split("\n")) {
        const request = JSON.parse(line);
        if (!request.id) continue;
        if (request.method === "windowsSandbox/setupStart") {
          child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { started: true } })}\n`);
          child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "windowsSandbox/setupCompleted", params: { mode: "unelevated", success: true, error: null } })}\n`);
        } else child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true } })}\n`);
      }
    });
    const client = new AppServerClient({ executable: "codex", spawnProcess: vi.fn(() => child) as any, timeoutMs: 100 });
    const notification = vi.fn(); const protocolError = vi.fn(); client.on("notification", notification); client.on("protocol-error", protocolError);
    await client.start(); await expect(client.request("thread/start", {})).resolves.toEqual({ ok: true });
    child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { delta: "hello" } })}\n`);
    child.stdout.write("not-json\n"); await vi.waitFor(() => expect(notification).toHaveBeenCalled());
    expect(protocolError).toHaveBeenCalledOnce(); await client.stop(); expect(child.kill).toHaveBeenCalledOnce();
  });

  it("times out a request and reports unexpected process exit", async () => {
    const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.killed = false; child.kill = vi.fn();
    const client = new AppServerClient({ executable: "codex", spawnProcess: vi.fn(() => child) as any, timeoutMs: 10 });
    await expect(client.start()).rejects.toThrow("initialize timed out");
    const failure = vi.fn(); client.on("failure", failure); child.emit("exit", 7, null); expect(failure).toHaveBeenCalled();
  });
});

class FakeClient extends EventEmitter {
  stopped = false; interrupted = false;
  async start(): Promise<void> {}
  async request(method: string): Promise<any> {
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") { queueMicrotask(() => { this.emit("notification", "item/agentMessage/delta", { itemId: "m1", delta: "Done" }); this.emit("notification", "item/started", { item: { type: "fileChange" } }); this.emit("notification", "item/started", { item: { type: "commandExecution", command: "pnpm test" } }); this.emit("notification", "turn/completed", { turn: { status: "completed" } }); }); return { turn: { id: "turn-1" } }; }
    if (method === "turn/interrupt") { this.interrupted = true; return {}; }
    if (method === "command/exec") return { exitCode: 0, stdout: "workspace", stderr: "" };
    return {};
  }
  async stop(): Promise<void> { this.stopped = true; }
}

describe("review task lifecycle", () => {
  it("reconstructs deltas, observes file/verification events and completes", async () => {
    const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => new FakeClient() as any });
    const task = manager.create(session()); await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("completed"));
    expect(manager.get(task.id)?.messages).toEqual([{ itemId: "m1", text: "Done" }]);
  });
  it("rejects duplicate and concurrent workspace tasks and permits retry after failure", () => {
    class WaitingClient extends FakeClient { override async request(method: string): Promise<any> { if (method === "thread/start") return { thread: { id: "t" } }; if (method === "turn/start") return { turn: { id: "u" } }; return {}; } }
    const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => new WaitingClient() as any });
    manager.create(session()); expect(() => manager.create(session())).toThrow("already running");
    const other = session(); other.sessionId = "review-2"; expect(() => manager.create(other)).toThrow("active write task");
  });
  it("creates a new task when retrying a failed ReviewSession", async () => {
    class FailingClient extends FakeClient { override async start(): Promise<void> { throw new Error("startup failed"); } }
    const clients = [new FailingClient(), new FakeClient()];
    const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => clients.shift() as any });
    const failed = manager.create(session()); await vi.waitFor(() => expect(manager.get(failed.id)?.status).toBe("failed"));
    const retry = manager.create(session()); expect(retry.id).not.toBe(failed.id);
    await vi.waitFor(() => expect(manager.get(retry.id)?.status).toBe("completed"));
  });
  it("cancels using turn/interrupt without rollback", async () => {
    const client = new FakeClient(); class WaitingClient extends FakeClient { override async request(method: string): Promise<any> { if (method === "thread/start") return { thread: { id: "t" } }; if (method === "turn/start") return { turn: { id: "u" } }; return super.request(method); } }
    const waiting = Object.assign(new WaitingClient(), client);
    const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => waiting as any }); const task = manager.create(session());
    await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("inspecting")); await manager.cancel(task.id);
    expect(waiting.interrupted).toBe(true); expect(manager.get(task.id)?.status).toBe("cancelled");
  });
  it("does not report cancelled when interrupt fails and follows later completion", async () => {
    class InterruptFailureClient extends FakeClient {
      override async request(method: string): Promise<any> {
        if (method === "thread/start") return { thread: { id: "t" } };
        if (method === "turn/start") return { turn: { id: "u" } };
        if (method === "turn/interrupt") throw new Error("interrupt unavailable");
        return super.request(method);
      }
    }
    const client = new InterruptFailureClient();
    const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => client as any }); const task = manager.create(session());
    await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("inspecting"));
    await expect(manager.cancel(task.id)).rejects.toThrow("interrupt unavailable");
    expect(manager.get(task.id)?.status).toBe("inspecting");
    client.emit("notification", "item/agentMessage/delta", { itemId: "final", delta: "Completed after cancel failed." });
    client.emit("notification", "turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("completed"));
    expect(manager.get(task.id)?.messages.at(-1)?.text).toBe("Completed after cancel failed.");
  });
  it("follows a later worker failure after cancellation itself fails", async () => {
    class InterruptFailureClient extends FakeClient {
      override async request(method: string): Promise<any> {
        if (method === "thread/start") return { thread: { id: "t" } };
        if (method === "turn/start") return { turn: { id: "u" } };
        if (method === "turn/interrupt") throw new Error("interrupt unavailable");
        return super.request(method);
      }
    }
    const client = new InterruptFailureClient(); const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => client as any });
    const task = manager.create({ ...session(), sessionId: "cancel-then-fail" }); await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("inspecting"));
    await expect(manager.cancel(task.id)).rejects.toThrow("interrupt unavailable");
    client.emit("notification", "turn/completed", { turn: { status: "failed" } });
    await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("failed"));
    expect(manager.get(task.id)?.error?.code).toBe("turn_failed");
  });
  it("preserves completion when it races with a successful cancel request", async () => {
    class RacingClient extends FakeClient {
      override async request(method: string): Promise<any> {
        if (method === "thread/start") return { thread: { id: "t" } };
        if (method === "turn/start") return { turn: { id: "u" } };
        if (method === "turn/interrupt") { this.emit("notification", "turn/completed", { turn: { status: "completed" } }); return {}; }
        return super.request(method);
      }
    }
    const client = new RacingClient(); const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => client as any }); const task = manager.create(session());
    await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("inspecting")); await manager.cancel(task.id);
    expect(manager.get(task.id)?.status).toBe("completed");
  });
  it("replays complete completed and failed histories to late subscribers", async () => {
    const completedManager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => new FakeClient() as any });
    const completed = completedManager.create(session()); await vi.waitFor(() => expect(completedManager.get(completed.id)?.status).toBe("completed"));
    const completedEvents: any[] = []; completedManager.subscribe(completed.id, (event) => completedEvents.push(event));
    expect(completedEvents.map((event) => event.type)).toEqual(["snapshot", "status", "status", "agent-message-delta", "status", "status", "status"]);
    expect(completedEvents.at(-2)).toMatchObject({ type: "status", status: "verifying" });
    expect(completedEvents.at(-1)).toEqual({ type: "status", status: "completed" });
    expect(completedManager.get(completed.id)?.messages).toEqual([{ itemId: "m1", text: "Done" }]);

    class FastFailureClient extends FakeClient {
      override async request(method: string): Promise<any> {
        if (method === "thread/start") return { thread: { id: "t" } };
        if (method === "turn/start") { queueMicrotask(() => this.emit("notification", "turn/completed", { turn: { status: "failed" } })); return { turn: { id: "u" } }; }
        return super.request(method);
      }
    }
    const failedManager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => new FastFailureClient() as any });
    const failed = failedManager.create({ ...session(), sessionId: "failed" }); await vi.waitFor(() => expect(failedManager.get(failed.id)?.status).toBe("failed"));
    const failedEvents: any[] = []; failedManager.subscribe(failed.id, (event) => failedEvents.push(event));
    expect(failedEvents.at(-2)?.type).toBe("error"); expect(failedEvents.at(-1)).toEqual({ type: "status", status: "failed" });
  });
  it("rejects a sandbox preflight failure before starting a worker thread", async () => {
    class PreflightFailureClient extends FakeClient {
      methods: string[] = [];
      override async request(method: string): Promise<any> {
        this.methods.push(method); if (method === "command/exec") throw new Error("setup refresh had errors"); return super.request(method);
      }
    }
    const client = new PreflightFailureClient(); const manager = new ReviewTaskManager({ workspace: process.cwd(), makeClient: () => client as any });
    const task = manager.create({ ...session(), sessionId: "preflight" }); await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("failed"));
    expect(client.methods).not.toContain("thread/start");
    expect(manager.get(task.id)?.error?.message).toContain("Codex cannot write to this workspace");
  });
  it("carries a confirmed session through a source change, verification event, reply and completion", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vi-worker-")); const target = join(workspace, "fixture.txt"); await writeFile(target, "before");
    class ImplementingClient extends FakeClient {
      override async request(method: string): Promise<any> {
        if (method === "thread/start") return { thread: { id: "integration-thread" } };
        if (method === "turn/start") {
          await writeFile(target, "after");
          queueMicrotask(() => {
            this.emit("notification", "item/started", { item: { type: "fileChange" } });
            this.emit("notification", "item/started", { item: { type: "commandExecution", command: "pnpm test" } });
            this.emit("notification", "item/agentMessage/delta", { itemId: "final", delta: "Updated fixture and verified it." });
            this.emit("notification", "turn/completed", { turn: { status: "completed" } });
          });
          return { turn: { id: "integration-turn" } };
        }
        return super.request(method);
      }
    }
    const manager = new ReviewTaskManager({ workspace, makeClient: () => new ImplementingClient() as any }); const task = manager.create(session());
    await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe("completed"));
    expect(await import("node:fs/promises").then(({ readFile }) => readFile(target, "utf8"))).toBe("after");
    expect(manager.get(task.id)?.messages[0]?.text).toContain("verified");
  });
});

describe("bridge security and validation", () => {
  it("validates an existing writable directory and rejects missing or file workspaces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vi-workspace-")); const file = join(directory, "not-a-directory"); await writeFile(file, "x");
    await expect(validateWorkspace(directory)).resolves.toBe(directory);
    await expect(validateWorkspace(join(directory, "missing"))).rejects.toThrow("does not exist");
    await expect(validateWorkspace(file)).rejects.toThrow("not a directory");
  });
  it("requires a confirmed structured ReviewSession and builds a bounded prompt", () => {
    expect(validateReviewSession(session())).toMatchObject({ sessionId: "review-1" });
    expect(() => validateReviewSession({ version: 1, status: "draft" })).toThrow();
    expect(workerPrompt(session())).toContain("Visual Review session");
  });
  it("binds loopback and rejects bad origins, tokens, CSRF, malformed sessions and arbitrary prompts", async () => {
    const bridge = await startBridge({ workspace: process.cwd(), origins: ["http://127.0.0.1:5173"], codexCli: process.execPath, capabilityToken: "secret" });
    const url = `http://127.0.0.1:${bridge.port}`;
    expect((await fetch(`${url}/review-tasks`, { method: "POST", headers: { origin: "http://evil.test" } })).status).toBe(403);
    expect((await fetch(`${url}/review-tasks`, { method: "POST", headers: { origin: "http://127.0.0.1:5173" } })).status).toBe(401);
    expect((await fetch(`${url}/review-tasks`, { method: "POST", headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer secret" } })).status).toBe(403);
    const secured = { origin: "http://127.0.0.1:5173", authorization: "Bearer secret", "x-codex-visual-csrf": "secret", "content-type": "application/json" };
    expect((await fetch(`${url}/review-tasks`, { method: "POST", headers: secured, body: JSON.stringify({ session: {} }) })).status).toBe(400);
    expect((await fetch(`${url}/prompt`, { method: "POST", headers: secured, body: JSON.stringify({ prompt: "arbitrary" }) })).status).toBe(404);
    await bridge.close();
  });
});
