import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { ReviewTaskEvent } from "../types";
import { AppServerClient } from "./app-server-client";
import { resolveCodexCli } from "./cli-resolver";
import { ReviewTaskManager } from "./task-manager";
import { validateReviewSession } from "./validation";

export interface BridgeOptions { workspace: string; origins: string[]; codexCli?: string; capabilityToken?: string; timeoutMs?: number }
export interface RunningBridge { port: number; token: string; close(): Promise<void> }

const json = (response: ServerResponse, status: number, value: unknown): void => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
const readJson = async (request: IncomingMessage): Promise<any> => {
  let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 1_000_000) throw new Error("Request is too large"); }
  return JSON.parse(body || "{}");
};

export async function startBridge(options: BridgeOptions): Promise<RunningBridge> {
  const workspace = resolve(options.workspace); const executable = await resolveCodexCli(options.codexCli);
  const token = options.capabilityToken ?? randomBytes(32).toString("base64url");
  const origins = new Set(options.origins);
  const manager = new ReviewTaskManager({ workspace, makeClient: () => new AppServerClient({ executable, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }) });
  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer");
    const origin = request.headers.origin;
    if (!origin || !origins.has(origin)) { json(response, 403, { error: "Origin is not allowed" }); return; }
    response.setHeader("access-control-allow-origin", origin); response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-headers", "authorization, content-type, x-codex-visual-csrf"); response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    if (request.headers.authorization !== `Bearer ${token}`) { json(response, 401, { error: "Invalid capability token" }); return; }
    if (request.method === "POST" && request.headers["x-codex-visual-csrf"] !== token) { json(response, 403, { error: "Invalid CSRF token" }); return; }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "POST" && url.pathname === "/review-tasks") {
        const body = await readJson(request); const task = manager.create(validateReviewSession(body.session)); json(response, 202, task); return;
      }
      const match = /^\/review-tasks\/([^/]+)\/(events|cancel)$/.exec(url.pathname);
      if (match?.[2] === "events" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", connection: "keep-alive" });
        const write = (event: ReviewTaskEvent): void => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); if (manager.isTerminal(match[1]!)) response.end(); };
        const unsubscribe = manager.subscribe(match[1]!, write); request.on("close", unsubscribe); return;
      }
      if (match?.[2] === "cancel" && request.method === "POST") { await manager.cancel(match[1]!); json(response, 200, manager.get(match[1]!)); return; }
      json(response, 404, { error: "Not found" });
    } catch (error) { json(response, /not found/i.test(String(error)) ? 404 : 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  await new Promise<void>((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolveReady()); });
  const port = (server.address() as AddressInfo).port;
  return { port, token, close: async () => { await manager.close(); await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); } };
}
