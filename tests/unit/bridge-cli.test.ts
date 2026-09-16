import { describe, expect, it, vi } from "vitest";
import { runBridgeCli } from "../../src/bridge/cli";
import type { AutostartAdapter } from "../../src/bridge/autostart";

const io = () => { const stdout: string[] = []; const stderr: string[] = []; return { stdout, stderr, value: { out: (text: string) => stdout.push(text), error: (text: string) => stderr.push(text) } }; };
const autostart = (status: "enabled" | "disabled" | "unavailable" = "disabled"): AutostartAdapter => ({ status: vi.fn(async () => status), install: vi.fn(async () => {}), remove: vi.fn(async () => {}) });

describe("bridge CLI", () => {
  it("treats repeated start as success without spawning another daemon", async () => {
    const output = io(); const spawnDaemon = vi.fn(); const request = vi.fn(async () => ({ ok: true, value: { controller: "running", bridge: { kind: "idle" } } }));
    expect(await runBridgeCli(["start"], output.value, { request, autostart: autostart(), spawnDaemon })).toBe(0); expect(spawnDaemon).not.toHaveBeenCalled();
  });
  it("prints token-free human and JSON status", async () => {
    const request = vi.fn(async () => ({ ok: true, value: { controller: "running", bridge: { kind: "connected", workspace: "C:\\app", origin: "http://127.0.0.1:5173" } } }));
    const human = io(); expect(await runBridgeCli(["status"], human.value, { request, autostart: autostart("enabled") })).toBe(0); expect(human.stdout.join("")).toContain("Bridge: connected"); expect(human.stdout.join("")).not.toMatch(/token|secret/i);
    const json = io(); expect(await runBridgeCli(["status", "--json"], json.value, { request, autostart: autostart("enabled") })).toBe(0); expect(JSON.parse(json.stdout.join("")).autostart).toBe("enabled"); expect(json.stdout.join("")).not.toMatch(/capability|pairingToken/i);
  });
  it("writes only the descriptor to stdout for pair", async () => {
    const descriptor = { version: 1, endpoint: "http://127.0.0.1:1", pairingToken: "pair", allowedOrigin: "http://127.0.0.1:5173", workspace: process.cwd(), expiresAt: "2030-01-01T00:00:00.000Z" };
    const output = io(); const request = vi.fn(async () => ({ ok: true, value: descriptor }));
    expect(await runBridgeCli(["pair", "--workspace", process.cwd(), "--origin", "http://127.0.0.1:5173"], output.value, { request, autostart: autostart() })).toBe(0); expect(JSON.parse(output.stdout.join(""))).toEqual(descriptor); expect(output.stderr).toEqual([]);
  });
  it("rejects missing arguments and unknown commands", async () => {
    const missing = io(); expect(await runBridgeCli(["pair", "--workspace", process.cwd()], missing.value, { autostart: autostart() })).toBe(1); expect(missing.stdout).toEqual([]);
    const unknown = io(); expect(await runBridgeCli(["launch"], unknown.value, { autostart: autostart() })).toBe(1);
  });
  it("installs and removes autostart only on explicit commands", async () => {
    const adapter = autostart(); const output = io(); const request = vi.fn(async () => ({ ok: true, value: { controller: "running", bridge: { kind: "idle" } } }));
    expect(await runBridgeCli(["autostart", "install"], output.value, { request, autostart: adapter })).toBe(0); expect(adapter.install).toHaveBeenCalledOnce();
    expect(await runBridgeCli(["autostart", "remove"], output.value, { request, autostart: adapter })).toBe(0); expect(adapter.remove).toHaveBeenCalledOnce();
  });
});
