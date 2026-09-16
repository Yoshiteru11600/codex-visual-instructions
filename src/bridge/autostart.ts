import { spawn } from "node:child_process";
import { createLinuxAutostart } from "./autostart-linux";
import { createMacAutostart } from "./autostart-macos";
import { createWindowsAutostart } from "./autostart-windows";

export type AutostartStatus = "enabled" | "disabled" | "unavailable";
export interface CommandResult { stdout: string; stderr: string; code: number }
export type CommandRunner = (executable: string, args: string[]) => Promise<CommandResult>;
export interface AutostartAdapter { status(): Promise<AutostartStatus>; install(): Promise<void>; remove(): Promise<void> }
export interface AutostartOptions { executable: string; cliPath: string; env?: NodeJS.ProcessEnv; run?: CommandRunner }

export const runCommand: CommandRunner = (executable, args) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; }); child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject); child.once("exit", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
});

export function createAutostartAdapter(options: AutostartOptions, platform = process.platform): AutostartAdapter {
  const normalized = { ...options, env: options.env ?? process.env, run: options.run ?? runCommand };
  if (platform === "win32") return createWindowsAutostart(normalized);
  if (platform === "darwin") return createMacAutostart(normalized);
  if (platform === "linux") return createLinuxAutostart(normalized);
  return { status: async () => "unavailable", install: async () => { throw new Error("Autostart is unavailable on this platform"); }, remove: async () => {} };
}
