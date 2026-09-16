import type { Server } from "node:net";
import type { BridgePairingDescriptor } from "../types";
import { startBridge, type RunningBridge } from "./http-server";
import { closeControllerServer, listenController, type ControllerReply, type ControllerRequest } from "./ipc";
import { validateOrigin, validateWorkspace } from "./validation";

export type ControllerState =
  | { kind: "idle" }
  | { kind: "pairing"; workspace: string; origin: string; expiresAt: string }
  | { kind: "connected"; workspace: string; origin: string }
  | { kind: "task-running"; workspace: string; origin: string; taskStatus: string };

export interface ControllerStatus { controller: "running"; bridge: ControllerState }
export interface BridgeControllerOptions { endpoint?: string; start?: typeof startBridge }

export class BridgeController {
  private bridge: RunningBridge | null = null; private workspace: string | null = null; private origin: string | null = null; private server: Server | null = null;
  constructor(private readonly options: BridgeControllerOptions = {}) {}
  async start(): Promise<void> { if (this.server) return; this.server = await listenController((request) => this.handle(request), this.options.endpoint); }
  status(): ControllerStatus {
    if (!this.bridge || !this.workspace || !this.origin) return { controller: "running", bridge: { kind: "idle" } };
    const status = this.bridge.status();
    if (status.activeTask) return { controller: "running", bridge: { kind: "task-running", workspace: this.workspace, origin: this.origin, taskStatus: status.taskStatus ?? "running" } };
    return { controller: "running", bridge: this.bridge.paired()
      ? { kind: "connected", workspace: this.workspace, origin: this.origin }
      : { kind: "pairing", workspace: this.workspace, origin: this.origin, expiresAt: this.bridge.descriptor.expiresAt } };
  }
  async pair(workspaceInput: string, originInput: string): Promise<BridgePairingDescriptor> {
    if (this.bridge?.status().activeTask) throw Object.assign(new Error("A task is running; the active workspace cannot be replaced"), { code: "workspace_busy" });
    const workspace = await validateWorkspace(workspaceInput); const origin = validateOrigin(originInput);
    if (this.bridge) { await this.bridge.close(); this.bridge = null; }
    this.bridge = await (this.options.start ?? startBridge)({ workspace, origins: [origin] }); this.workspace = workspace; this.origin = origin;
    return this.bridge.descriptor;
  }
  async stop(): Promise<void> {
    if (this.bridge?.status().activeTask) throw Object.assign(new Error("A task is running; stop was refused"), { code: "workspace_busy" });
    if (this.bridge) await this.bridge.close(); this.bridge = null; this.workspace = null; this.origin = null;
    const server = this.server; this.server = null; if (server) await closeControllerServer(server, this.options.endpoint);
  }
  private async handle(request: ControllerRequest): Promise<ControllerReply> {
    try {
      if (request.command === "status") return { ok: true, value: this.status() };
      if (request.command === "pair") return { ok: true, value: await this.pair(request.workspace, request.origin) };
      const active = this.bridge?.status().activeTask; if (active) return { ok: false, code: "workspace_busy", message: "A task is running; stop was refused" };
      setTimeout(() => { void this.stop(); }, 0); return { ok: true };
    } catch (error) { const value = error as Error & { code?: string }; return { ok: false, code: value.code ?? "controller_error", message: value.message }; }
  }
}

export async function runController(options: BridgeControllerOptions = {}): Promise<BridgeController> { const controller = new BridgeController(options); await controller.start(); return controller; }
