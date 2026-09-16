import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { closeControllerServer, listenController, controllerEndpoint, parseControllerRequest, requestController } from "../../src/bridge/ipc";

describe("controller IPC", () => {
  it("uses a per-user named pipe on Windows and a runtime socket elsewhere", () => {
    expect(controllerEndpoint("win32", { USERNAME: "alice" }, undefined)).toMatch(/^\\\\\.\\pipe\\codex-visual-bridge-/);
    expect(controllerEndpoint("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }, 1000)).toBe("/run/user/1000/controller.sock");
  });
  it("accepts only the fixed command schema", () => {
    expect(parseControllerRequest({ command: "status" })).toEqual({ command: "status" });
    expect(parseControllerRequest({ command: "pair", workspace: "/app", origin: "http://127.0.0.1:1" })).toEqual({ command: "pair", workspace: "/app", origin: "http://127.0.0.1:1" });
    expect(() => parseControllerRequest({ command: "pair", workspace: "/app", origin: "x", env: { PATH: "evil" } })).toThrow("Unknown IPC");
    expect(() => parseControllerRequest({ command: "exec", executable: "cmd" })).toThrow("Unknown IPC");
  });
  it("round-trips fixed requests over local IPC", async () => {
    const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\codex-visual-bridge-test-${randomUUID()}` : `${process.env.TMPDIR ?? "/tmp"}/codex-visual-bridge-test-${randomUUID()}.sock`;
    const server = await listenController(async (request) => ({ ok: true, value: request.command }), endpoint);
    expect(await requestController({ command: "status" }, endpoint)).toEqual({ ok: true, value: "status" }); await closeControllerServer(server, endpoint);
  });
});
