import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutostartAdapter } from "../../src/bridge/autostart";

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
describe("autostart adapters", () => {
  it("keeps Windows registration token and workspace free and idempotent", async () => {
    const calls: Array<[string, string[]]> = []; let installed = false; const run = vi.fn(async (executable: string, args: string[]) => { calls.push([executable, args]); const script = Buffer.from(args.at(-1)!, "base64").toString("utf16le"); if (/CreateShortcut\(\$p\);\$s\.TargetPath/.test(script)) { installed = true; return { code: 0, stdout: "", stderr: "" }; } return { code: 0, stdout: installed ? "match\r\n" : "missing\r\n", stderr: "" }; });
    const adapter = createAutostartAdapter({ executable: "C:\\Program Files\\node.exe", cliPath: "C:\\Tools 日本語\\cli.js", env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, run }, "win32"); await adapter.install(); await adapter.install(); expect(await adapter.status()).toBe("enabled");
    const scripts = calls.map(([, args]) => Buffer.from(args.at(-1)!, "base64").toString("utf16le")).join("\n"); const embedded = [...scripts.matchAll(/FromBase64String\('([^']+)'\)/g)].map((match) => Buffer.from(match[1]!, "base64").toString("utf8")).join("\n"); expect(embedded).toContain("daemon"); expect(`${scripts}\n${embedded}`).not.toMatch(/workspace|origin|pairingToken|capabilityToken/i); expect(calls.filter(([, args]) => /\.TargetPath=/.test(Buffer.from(args.at(-1)!, "base64").toString("utf16le")))).toHaveLength(1);
  });
  it("writes macOS ProgramArguments without review authority", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-mac-")); temporary.push(home); const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })); const adapter = createAutostartAdapter({ executable: "/Applications/Node JS/node", cliPath: "/Users/me/ツール/cli.js", env: { HOME: home }, run }, "darwin"); await adapter.install();
    const plist = await readFile(join(home, "Library", "LaunchAgents", "com.openai.codex-visual-bridge.plist"), "utf8"); expect(plist).toContain("<string>daemon</string>"); expect(plist).not.toMatch(/workspace|origin|token/i); await adapter.remove(); await adapter.remove();
  });
  it("writes a user-scoped systemd service and removes only its own marker", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-linux-")); temporary.push(home); const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })); const adapter = createAutostartAdapter({ executable: "/opt/Node JS/node", cliPath: "/home/me/ツール/cli.js", env: { HOME: home }, run }, "linux"); await adapter.install();
    const unit = await readFile(join(home, ".config", "systemd", "user", "codex-visual-bridge.service"), "utf8"); expect(unit).toContain("daemon"); expect(unit).not.toMatch(/workspace|origin|token/i); await adapter.remove(); await adapter.remove();
  });
  it("does not silently fall back on unsupported systems", async () => { const adapter = createAutostartAdapter({ executable: "node", cliPath: "cli.js" }, "freebsd"); expect(await adapter.status()).toBe("unavailable"); await expect(adapter.install()).rejects.toThrow("unavailable"); });
});
