#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAutostartAdapter, type AutostartAdapter } from "./autostart";
import { runController } from "./controller";
import { startBridge } from "./http-server";
import { requestController, type ControllerReply } from "./ipc";

interface CliIo { out(value: string): void; error(value: string): void }
interface CliDependencies { request?: typeof requestController; daemon?: typeof runController; autostart?: AutostartAdapter; spawnDaemon?: () => void; cliPath?: string; executable?: string }
const defaultIo: CliIo = { out: (value) => process.stdout.write(value), error: (value) => process.stderr.write(value) };
const valueAfter = (args: string[], name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const requireValue = (args: string[], name: string): string => { const value = valueAfter(args, name); if (!value || value.startsWith("--")) throw new Error(`${name} is required`); return value; };
const help = `Codex Visual Bridge

Usage:
  codex-visual-bridge start
  codex-visual-bridge status [--json]
  codex-visual-bridge stop
  codex-visual-bridge pair --workspace <absolute-path> --origin <exact-origin>
  codex-visual-bridge autostart install|remove

The daemon command is internal. Autostart never stores a workspace, Origin, or token.
Legacy foreground mode remains available with --workspace and --origin.
`;
const stopped = () => ({ controller: "stopped", bridge: { kind: "idle" } });
const formatStatus = (status: any, autostart: string): string => {
  const bridge = status.bridge ?? { kind: "idle" }; const workspace = bridge.workspace ?? "none"; const origin = bridge.origin ?? "none"; const task = bridge.taskStatus ?? "none";
  return `Controller: ${status.controller}\nAutostart: ${autostart}\nBridge: ${bridge.kind}\nWorkspace: ${workspace}\nOrigin: ${origin}\nTask: ${task}\n`;
};
const ensureReply = (reply: ControllerReply): unknown => { if (!reply.ok) throw Object.assign(new Error(reply.message ?? "Controller request failed"), { code: reply.code }); return reply.value; };

export async function runBridgeCli(args: string[], io: CliIo = defaultIo, dependencies: CliDependencies = {}): Promise<number> {
  const cliPath = dependencies.cliPath ?? fileURLToPath(import.meta.url); const executable = dependencies.executable ?? process.execPath;
  const request = dependencies.request ?? requestController; const autostart = dependencies.autostart ?? createAutostartAdapter({ executable, cliPath });
  const spawnDaemon = dependencies.spawnDaemon ?? (() => { const child = spawn(executable, [cliPath, "daemon"], { detached: true, windowsHide: true, stdio: "ignore", shell: false }); child.unref(); });
  try {
    if (!args.length || args.includes("--help") || args.includes("-h")) { io.out(help); return 0; }
    const command = args[0];
    if (command === "daemon") { await (dependencies.daemon ?? runController)(); return 0; }
    if (command === "start") {
      try { ensureReply(await request({ command: "status" })); io.error("Controller is already running.\n"); return 0; } catch { spawnDaemon(); }
      for (let attempt = 0; attempt < 40; attempt += 1) { await new Promise((resolveDelay) => setTimeout(resolveDelay, 50)); try { ensureReply(await request({ command: "status" })); io.error("Controller started.\n"); return 0; } catch { /* wait for readiness */ } }
      throw new Error("Controller did not become ready");
    }
    if (command === "status") {
      const autostartStatus = await autostart.status(); let status: any;
      try { status = ensureReply(await request({ command: "status" })); } catch { status = stopped(); }
      if (args.includes("--json")) io.out(`${JSON.stringify({ ...status, autostart: autostartStatus })}\n`); else io.out(formatStatus(status, autostartStatus)); return 0;
    }
    if (command === "stop") { try { ensureReply(await request({ command: "stop" })); io.error("Controller stopped. Autostart registration was not changed.\n"); return 0; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || /connect/i.test(String(error))) { io.error("Controller is already stopped.\n"); return 0; } throw error; } }
    if (command === "pair") {
      const workspace = resolve(requireValue(args, "--workspace")); const origin = requireValue(args, "--origin");
      let reply: ControllerReply; try { reply = await request({ command: "pair", workspace, origin }); } catch { throw new Error("Controller is stopped. Run `codex-visual-bridge start` or `codex-visual-bridge autostart install` first."); }
      io.out(`${JSON.stringify(ensureReply(reply))}\n`); return 0;
    }
    if (command === "autostart") {
      const action = args[1]; if (action === "install") { await autostart.install(); return runBridgeCli(["start"], io, { ...dependencies, request, autostart, spawnDaemon, cliPath, executable }); }
      if (action === "remove") { await autostart.remove(); io.error("Autostart removed. The current controller keeps running until `codex-visual-bridge stop`.\n"); return 0; }
      throw new Error("autostart requires install or remove");
    }
    if (args.includes("--workspace") || args.includes("--origin")) {
      io.error("Deprecated foreground mode. Prefer `start` followed by `pair`.\n");
      const workspace = resolve(requireValue(args, "--workspace")); const origin = requireValue(args, "--origin"); const codexCli = valueAfter(args, "--codex-cli");
      const bridge = await startBridge({ workspace, origins: [origin], ...(codexCli ? { codexCli } : {}) }); io.out(`${JSON.stringify(bridge.descriptor)}\n`);
      const close = async (): Promise<void> => { await bridge.close(); process.exit(0); }; process.once("SIGINT", () => { void close(); }); process.once("SIGTERM", () => { void close(); }); return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) { io.error(`${error instanceof Error ? error.message : String(error)}\n`); return 1; }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) process.exitCode = await runBridgeCli(process.argv.slice(2));
