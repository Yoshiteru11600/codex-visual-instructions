import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ReviewSession } from "../../src";
import { AppServerClient, ReviewTaskManager, resolveCodexCli, startBridge, validateReviewSession, workerPrompt } from "../../src/bridge";

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
