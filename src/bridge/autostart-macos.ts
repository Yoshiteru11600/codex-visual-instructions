import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AutostartAdapter, AutostartOptions } from "./autostart";

const LABEL = "com.openai.codex-visual-bridge";
const xmlEscape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function createMacAutostart(options: Required<Pick<AutostartOptions, "executable" | "cliPath" | "env">> & Pick<AutostartOptions, "run">): AutostartAdapter {
  const path = join(options.env.HOME ?? "", "Library", "LaunchAgents", `${LABEL}.plist`); const run = options.run!;
  return {
    status: async () => { try { return (await readFile(path, "utf8")).includes(`<string>${LABEL}</string>`) ? "enabled" : "disabled"; } catch { return "disabled"; } },
    install: async () => { await mkdir(dirname(path), { recursive: true }); const content = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>${xmlEscape(options.executable)}</string><string>${xmlEscape(options.cliPath)}</string><string>daemon</string></array><key>RunAtLoad</key><true/></dict></plist>`; const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, path); const result = await run("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? ""}`, path]); if (result.code !== 0 && !/already/i.test(result.stderr)) { await rm(path, { force: true }); throw new Error("Unable to register LaunchAgent"); } },
    remove: async () => { const content = await readFile(path, "utf8").catch(() => ""); if (!content) return; if (!content.includes(`<string>${LABEL}</string>`)) throw new Error("LaunchAgent is not managed by Codex Visual Bridge"); await run("launchctl", ["bootout", `gui/${process.getuid?.() ?? ""}`, path]); await rm(path, { force: true }); },
  };
}
