import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ReviewSession, ReviewTask, ReviewTaskEvent, ReviewTaskStatus } from "../types";
import { AppServerClient } from "./app-server-client";
import { workerPrompt } from "./validation";

type InternalTask = ReviewTask & { threadId?: string; turnId?: string; events: ReviewTaskEvent[]; emitter: EventEmitter; client: AppServerClient; cancelRequested?: boolean };
const active = new Set<ReviewTaskStatus>(["queued", "accepted", "inspecting", "implementing", "verifying"]);

const firstString = (value: any, ...paths: string[]): string | undefined => {
  for (const path of paths) {
    let current = value; for (const key of path.split(".")) current = current?.[key];
    if (typeof current === "string") return current;
  }
  return undefined;
};

export interface TaskManagerOptions { workspace: string; makeClient(): AppServerClient }

export class ReviewTaskManager {
  private readonly tasks = new Map<string, InternalTask>();
  constructor(private readonly options: TaskManagerOptions) {}

  create(session: ReviewSession): ReviewTask {
    if ([...this.tasks.values()].some((task) => active.has(task.status) && task.reviewSessionId === session.sessionId)) throw new Error("This ReviewSession is already running");
    if ([...this.tasks.values()].some((task) => active.has(task.status))) throw new Error("This workspace already has an active write task");
    const task: InternalTask = { id: randomUUID(), reviewSessionId: session.sessionId, status: "queued", messages: [], events: [], emitter: new EventEmitter(), client: this.options.makeClient() };
    this.tasks.set(task.id, task); this.publish(task, { type: "snapshot", task: this.publicTask(task) });
    void this.run(task, session);
    return this.publicTask(task);
  }
  get(id: string): ReviewTask | undefined { const task = this.tasks.get(id); return task && this.publicTask(task); }
  subscribe(id: string, listener: (event: ReviewTaskEvent) => void): () => void {
    const task = this.tasks.get(id); if (!task) throw new Error("ReviewTask not found");
    for (const event of task.events) listener(event);
    if (!active.has(task.status)) return () => {};
    task.emitter.on("event", listener); return () => task.emitter.off("event", listener);
  }
  isTerminal(id: string): boolean { const status = this.tasks.get(id)?.status; return Boolean(status && !active.has(status)); }
  async cancel(id: string): Promise<void> {
    const task = this.tasks.get(id); if (!task) throw new Error("ReviewTask not found");
    if (!active.has(task.status)) return;
    task.cancelRequested = true;
    try {
      if (!task.threadId || !task.turnId) throw new Error("Codex turn is not ready to be interrupted");
      await task.client.request("turn/interrupt", { threadId: task.threadId, turnId: task.turnId });
    } catch (error) {
      task.cancelRequested = false;
      throw error;
    }
  }
  async close(): Promise<void> { await Promise.all([...this.tasks.values()].map((task) => task.client.stop())); }

  private async run(task: InternalTask, session: ReviewSession): Promise<void> {
    try {
      task.client.on("notification", (method: string, params: unknown) => this.onNotification(task, method, params));
      task.client.on("protocol-error", (error: Error) => this.fail(task, "protocol_error", error.message));
      task.client.on("failure", (error: Error) => { if (active.has(task.status)) this.fail(task, "process_error", error.message); });
      await task.client.start(); this.setStatus(task, "accepted");
      await this.preflightWorkspace(task.client);
      const thread = await task.client.request("thread/start", {
        cwd: this.options.workspace, approvalPolicy: "never", sandbox: "workspace-write",
        config: { sandbox_workspace_write: { writable_roots: [], network_access: false } },
      });
      const threadId = firstString(thread, "thread.id", "id", "threadId");
      if (!threadId) throw new Error("thread/start did not return a thread ID");
      task.threadId = threadId;
      this.setStatus(task, "inspecting");
      const turn = await task.client.request("turn/start", { threadId: task.threadId, input: [{ type: "text", text: workerPrompt(session) }] });
      const turnId = firstString(turn, "turn.id", "id", "turnId");
      if (!turnId) throw new Error("turn/start did not return a turn ID");
      task.turnId = turnId;
    } catch (error) { if (active.has(task.status)) this.fail(task, "worker_start_failed", error instanceof Error ? error.message : String(error)); }
  }
  private onNotification(task: InternalTask, method: string, params: any): void {
    if (!active.has(task.status)) return;
    if (method === "item/agentMessage/delta") {
      const itemId = firstString(params, "itemId", "item.id") ?? "agent-message";
      const delta = firstString(params, "delta", "text") ?? "";
      if (!delta) return;
      let message = task.messages.find((entry) => entry.itemId === itemId);
      if (!message) { message = { itemId, text: "" }; task.messages.push(message); }
      message.text += delta; this.publish(task, { type: "agent-message-delta", itemId, delta }); return;
    }
    if (method === "item/started" || method === "item/completed") {
      const type = firstString(params, "item.type", "type");
      if (type === "fileChange") this.setStatus(task, "implementing");
      if (type === "commandExecution") {
        const command = firstString(params, "item.command", "command") ?? "";
        if (/\b(test|lint|typecheck|build|check)\b/i.test(command)) this.setStatus(task, "verifying");
      }
      return;
    }
    if (method === "turn/completed") {
      const turnStatus = firstString(params, "turn.status", "status");
      if (turnStatus === "interrupted" && task.cancelRequested) { this.setStatus(task, "cancelled"); void task.client.stop(); }
      else if (turnStatus && !["completed", "success", "succeeded"].includes(turnStatus)) this.fail(task, "turn_failed", `Codex turn ended with status ${turnStatus}`);
      else { this.setStatus(task, "completed"); void task.client.stop(); }
    }
  }
  private async preflightWorkspace(client: AppServerClient): Promise<void> {
    const command = process.platform === "win32" ? ["cmd.exe", "/d", "/c", "cd"] : ["pwd"];
    try {
      const result = await client.request("command/exec", {
        command, cwd: this.options.workspace,
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [this.options.workspace], networkAccess: false }, timeoutMs: 10_000,
      });
      if (typeof result?.exitCode === "number" && result.exitCode !== 0) throw new Error(result.stderr || `exit code ${result.exitCode}`);
    } catch (error) {
      throw new Error(`Codex could not initialize this workspace with the required workspace-write sandbox. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private setStatus(task: InternalTask, status: ReviewTaskStatus): void { if (task.status === status) return; task.status = status; this.publish(task, { type: "status", status }); }
  private fail(task: InternalTask, code: string, message: string): void { task.error = { code, message }; this.publish(task, { type: "error", error: task.error }); this.setStatus(task, "failed"); void task.client.stop(); }
  private publish(task: InternalTask, event: ReviewTaskEvent): void { task.events.push(event); task.emitter.emit("event", event); }
  private publicTask(task: InternalTask): ReviewTask { return { id: task.id, reviewSessionId: task.reviewSessionId, status: task.status, messages: task.messages.map((message) => ({ ...message })), ...(task.error ? { error: { ...task.error } } : {}) }; }
}
