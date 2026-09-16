import { createHash } from "node:crypto";
import { mkdir, chmod, rm } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, posix } from "node:path";

export type ControllerRequest = { command: "status" } | { command: "stop" } | { command: "pair"; workspace: string; origin: string };
export interface ControllerReply { ok: boolean; value?: unknown; code?: string; message?: string }
const MAX_REQUEST_BYTES = 16_384;

export function controllerEndpoint(platform = process.platform, env = process.env, uid = process.getuid?.()): string {
  const identity = `${env.USERNAME ?? env.USER ?? "user"}-${uid ?? "windows"}`;
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  if (platform === "win32") return `\\\\.\\pipe\\codex-visual-bridge-${suffix}`;
  return posix.join(env.XDG_RUNTIME_DIR || posix.join(tmpdir().replaceAll("\\", "/"), `codex-visual-bridge-${uid ?? suffix}`), "controller.sock");
}

export function parseControllerRequest(value: unknown): ControllerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("IPC request must be an object");
  const record = value as Record<string, unknown>; const command = record.command;
  if (command !== "status" && command !== "stop" && command !== "pair") throw new Error("Unknown IPC command or field");
  const allowed = command === "pair" ? ["command", "workspace", "origin"] : ["command"];
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new Error("Unknown IPC command or field");
  if (command === "status" || command === "stop") return { command };
  if (command === "pair" && typeof record.workspace === "string" && typeof record.origin === "string") return { command, workspace: record.workspace, origin: record.origin };
  throw new Error("Invalid IPC request");
}

export async function requestController(request: ControllerRequest, endpoint = controllerEndpoint(), timeoutMs = 2_000): Promise<ControllerReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint); let body = ""; const timer = setTimeout(() => socket.destroy(new Error("Controller request timed out")), timeoutMs);
    socket.setEncoding("utf8"); socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => { body += chunk; if (body.length > MAX_REQUEST_BYTES) socket.destroy(new Error("Controller response is too large")); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.once("end", () => { clearTimeout(timer); try { resolve(JSON.parse(body) as ControllerReply); } catch { reject(new Error("Invalid controller response")); } });
  });
}

export async function listenController(handler: (request: ControllerRequest) => Promise<ControllerReply>, endpoint = controllerEndpoint()): Promise<Server> {
  if (process.platform !== "win32") {
    await mkdir(dirname(endpoint), { recursive: true, mode: 0o700 });
    try { await requestController({ command: "status" }, endpoint, 300); throw new Error("Controller is already running"); }
    catch (error) { if (error instanceof Error && error.message === "Controller is already running") throw error; await rm(endpoint, { force: true }); }
  }
  const server = createServer((socket) => {
    socket.setEncoding("utf8"); let body = ""; let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return; body += chunk;
      if (body.length > MAX_REQUEST_BYTES) { handled = true; socket.end(JSON.stringify({ ok: false, code: "invalid_request", message: "IPC request is too large" })); return; }
      if (!body.includes("\n")) return; handled = true; void (async () => {
        try { const line = body.slice(0, body.indexOf("\n")).trim(); const request = parseControllerRequest(JSON.parse(line)); socket.end(JSON.stringify(await handler(request))); }
        catch (error) { socket.end(JSON.stringify({ ok: false, code: "invalid_request", message: error instanceof Error ? error.message : "Invalid request" })); }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
  if (process.platform !== "win32") await chmod(endpoint, 0o600);
  return server;
}

export async function closeControllerServer(server: Server, endpoint = controllerEndpoint()): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (process.platform !== "win32") await rm(endpoint, { force: true });
}
