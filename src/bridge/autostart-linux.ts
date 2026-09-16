import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AutostartAdapter, AutostartOptions } from "./autostart";

const SERVICE = "codex-visual-bridge.service"; const MARKER = "Codex Visual Bridge current-user controller";
const systemdQuote = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
export function createLinuxAutostart(options: Required<Pick<AutostartOptions, "executable" | "cliPath" | "env">> & Pick<AutostartOptions, "run">): AutostartAdapter {
  const path = join(options.env.XDG_CONFIG_HOME || join(options.env.HOME ?? "", ".config"), "systemd", "user", SERVICE); const run = options.run!;
  return {
    status: async () => { try { const content = await readFile(path, "utf8"); if (!content.includes(MARKER)) return "disabled"; const result = await run("systemctl", ["--user", "is-enabled", SERVICE]); return result.code === 0 ? "enabled" : "disabled"; } catch { return "disabled"; } },
    install: async () => { const probe = await run("systemctl", ["--user", "--version"]).catch(() => ({ code: 1, stdout: "", stderr: "" })); if (probe.code !== 0) throw new Error("systemd user services are unavailable"); await mkdir(dirname(path), { recursive: true }); const content = `[Unit]\nDescription=${MARKER}\n[Service]\nExecStart=${systemdQuote(options.executable)} ${systemdQuote(options.cliPath)} daemon\nRestart=on-failure\n[Install]\nWantedBy=default.target\n`; const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, path); const result = await run("systemctl", ["--user", "enable", "--now", SERVICE]); if (result.code !== 0) { await rm(path, { force: true }); throw new Error("Unable to enable systemd user service"); } },
    remove: async () => { const content = await readFile(path, "utf8").catch(() => ""); if (!content) return; if (!content.includes(MARKER)) throw new Error("Service is not managed by Codex Visual Bridge"); await run("systemctl", ["--user", "disable", SERVICE]); await rm(path, { force: true }); await run("systemctl", ["--user", "daemon-reload"]); },
  };
}
