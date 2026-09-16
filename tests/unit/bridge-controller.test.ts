import { describe, expect, it, vi } from "vitest";
import { BridgeController } from "../../src/bridge/controller";
import type { RunningBridge } from "../../src/bridge/http-server";

const descriptor = (workspace: string, origin: string) => ({ version: 1 as const, endpoint: "http://127.0.0.1:1234", pairingToken: "short-lived", allowedOrigin: origin, workspace, expiresAt: "2030-01-01T00:00:00.000Z" });
describe("BridgeController", () => {
  it("starts idle, pairs one exact workspace and replaces an inactive bridge", async () => {
    const bridges: Array<{ close: ReturnType<typeof vi.fn>; paired: boolean }> = [];
    const start = vi.fn(async ({ workspace, origins }: { workspace: string; origins: string[] }) => { const state = { close: vi.fn(async () => {}), paired: false }; bridges.push(state); return { port: 1234, descriptor: descriptor(workspace, origins[0]!), status: () => ({ workspace, readiness: { status: "ready" as const }, state: "running" as const, activeTask: false }), paired: () => state.paired, close: state.close } satisfies RunningBridge; });
    const controller = new BridgeController({ start: start as any }); expect(controller.status().bridge.kind).toBe("idle");
    await controller.pair(process.cwd(), "http://127.0.0.1:5173"); expect(controller.status().bridge.kind).toBe("pairing"); bridges[0]!.paired = true; expect(controller.status().bridge.kind).toBe("connected");
    await controller.pair(process.cwd(), "http://localhost:5173"); expect(bridges[0]!.close).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledTimes(2);
  });
  it("refuses workspace replacement and stop while a task is running", async () => {
    const bridge: RunningBridge = { port: 1, descriptor: descriptor(process.cwd(), "http://127.0.0.1:5173"), paired: () => true, status: () => ({ workspace: process.cwd(), readiness: { status: "ready" }, state: "running", activeTask: true, taskStatus: "implementing" }), close: vi.fn(async () => {}) };
    const controller = new BridgeController({ start: vi.fn(async () => bridge) }); await controller.pair(process.cwd(), "http://127.0.0.1:5173");
    expect(controller.status().bridge.kind).toBe("task-running"); await expect(controller.pair(process.cwd(), "http://localhost:5173")).rejects.toMatchObject({ code: "workspace_busy" }); await expect(controller.stop()).rejects.toMatchObject({ code: "workspace_busy" }); expect(bridge.close).not.toHaveBeenCalled();
  });
});
