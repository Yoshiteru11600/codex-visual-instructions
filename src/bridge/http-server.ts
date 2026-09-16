import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import type { BridgeErrorCode, BridgePairingDescriptor, BridgeReadiness, BridgeStatus, ReviewTaskEvent } from "../types";
import { AppServerClient } from "./app-server-client";
import { resolveCodexCli } from "./cli-resolver";
import { PairingSession } from "./pairing";
import { ReviewTaskManager } from "./task-manager";
import { validateOrigin, validateReviewSession, validateWorkspace } from "./validation";

export interface BridgeOptions { workspace: string; origins: string[]; codexCli?: string; timeoutMs?: number; pairingTtlMs?: number; now?: () => number }
export interface RunningBridge { port: number; descriptor: BridgePairingDescriptor; status(): BridgeStatus; paired(): boolean; close(): Promise<void> }
const json = (response: ServerResponse, status: number, value: unknown): void => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
const sendError = (response: ServerResponse, status: number, code: BridgeErrorCode, message: string): void => json(response, status, { code, message });
const bearer = (request: IncomingMessage): string => request.headers.authorization?.replace(/^Bearer /, "") ?? "";
const readJson = async (request: IncomingMessage): Promise<any> => { let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 1_000_000) throw new Error("Request is too large"); } return JSON.parse(body || "{}"); };

export async function startBridge(options: BridgeOptions): Promise<RunningBridge> {
  if (options.origins.length !== 1) throw new Error("Exactly one --origin is required for pairing");
  const allowedOrigin = validateOrigin(options.origins[0]!); const workspacePath = resolve(options.workspace);
  let readiness: BridgeReadiness = { status: "ready" }; let workspace = workspacePath; let executable = "";
  try { workspace = await validateWorkspace(workspacePath); } catch (cause) { readiness = { status: "workspace_invalid", message: cause instanceof Error ? cause.message : String(cause) }; }
  if (readiness.status === "ready") try { executable = await resolveCodexCli(options.codexCli); } catch (cause) { readiness = { status: "cli_unavailable", message: cause instanceof Error ? cause.message : String(cause) }; }
  let manager = readiness.status === "ready" ? new ReviewTaskManager({ workspace, makeClient: () => new AppServerClient({ executable, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }) }) : null;
  // Assigned after the OS selects the loopback port; request handling starts afterward.
  // eslint-disable-next-line prefer-const
  let pairing: PairingSession;
  const status = (): BridgeStatus => { const task = manager?.activeTask(); return { workspace, readiness, state: "running", activeTask: Boolean(task), ...(task ? { taskStatus: task.status } : {}) }; };
  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer");
    const origin = request.headers.origin;
    if (!origin || origin !== allowedOrigin) { sendError(response, 403, "origin_mismatch", "Origin is not allowed"); return; }
    response.setHeader("access-control-allow-origin", origin); response.setHeader("vary", "Origin"); response.setHeader("access-control-allow-headers", "authorization, content-type, x-codex-visual-csrf"); response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const url = new URL(request.url ?? "/", "http://127.0.0.1"); const token = bearer(request); const pairingResult = pairing.verify(token, options.now?.());
    try {
      if (url.pathname === "/pairing" && request.method === "GET") {
        if (pairingResult === "expired") { sendError(response, 410, "pairing_expired", "Pairing information has expired"); return; }
        if (pairingResult === "used") { sendError(response, 409, "pairing_already_used", "Pairing information was already used"); return; }
        if (pairingResult !== "valid") { sendError(response, 401, "invalid_token", "Invalid pairing token"); return; }
        const descriptor = pairing.descriptor(); json(response, 200, { endpoint: descriptor.endpoint, allowedOrigin, workspace, expiresAt: descriptor.expiresAt, readiness, activeTask: Boolean(manager?.activeTask()) }); return;
      }
      if (url.pathname === "/pairing/approve" && request.method === "POST") {
        if (request.headers["x-codex-visual-csrf"] !== token) { sendError(response, 403, "invalid_token", "Invalid CSRF token"); return; }
        if (pairingResult === "expired") { sendError(response, 410, "pairing_expired", "Pairing information has expired"); return; }
        if (pairingResult === "used") { sendError(response, 409, "pairing_already_used", "Pairing information was already used"); return; }
        if (pairingResult !== "valid") { sendError(response, 401, "invalid_token", "Invalid pairing token"); return; }
        if (readiness.status !== "ready") { const unavailable = readiness as Exclude<BridgeReadiness, { status: "ready" }>; sendError(response, 503, unavailable.status, unavailable.message); return; }
        const capabilityToken = pairing.approve(token); json(response, 200, { capabilityToken, status: status() }); return;
      }
      if (!pairing.isRuntimeToken(token)) { sendError(response, 401, "invalid_token", "Invalid capability token"); return; }
      if (request.method === "POST" && request.headers["x-codex-visual-csrf"] !== token) { sendError(response, 403, "invalid_token", "Invalid CSRF token"); return; }
      if (url.pathname === "/status" && request.method === "GET") { json(response, 200, status()); return; }
      if (readiness.status !== "ready") { const unavailable = readiness as Exclude<BridgeReadiness, { status: "ready" }>; sendError(response, 503, unavailable.status, unavailable.message); return; }
      if (!manager) { sendError(response, 503, "bridge_not_ready", "Bridge task manager is not ready"); return; }
      if (request.method === "POST" && url.pathname === "/review-tasks") {
        try { const body = await readJson(request); const task = manager.create(validateReviewSession(body.session)); json(response, 202, task); }
        catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); const duplicate = /already running/i.test(message); const busy = /active write task/i.test(message); sendError(response, duplicate || busy ? 409 : 400, duplicate ? "review_session_already_running" : busy ? "workspace_busy" : "review_session_invalid", message); } return;
      }
      const match = /^\/review-tasks\/([^/]+)\/(events|cancel)$/.exec(url.pathname);
      if (match?.[2] === "events" && request.method === "GET") { response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", connection: "keep-alive" }); const write = (event: ReviewTaskEvent): void => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); if (event.type === "status" && ["completed", "failed", "cancelled"].includes(event.status)) response.end(); }; const unsubscribe = manager.subscribe(match[1]!, write); request.on("close", unsubscribe); return; }
      if (match?.[2] === "cancel" && request.method === "POST") { await manager.cancel(match[1]!); json(response, 200, manager.get(match[1]!)); return; }
      sendError(response, 404, "task_not_found", "Not found");
    } catch (cause) { const missing = /not found/i.test(String(cause)); sendError(response, missing ? 404 : 400, missing ? "task_not_found" : "protocol_error", cause instanceof Error ? cause.message : String(cause)); }
  });
  await new Promise<void>((ok, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ok); });
  const port = (server.address() as AddressInfo).port; pairing = new PairingSession(`http://127.0.0.1:${port}`, allowedOrigin, workspace, { ...(options.pairingTtlMs === undefined ? {} : { ttlMs: options.pairingTtlMs }), ...(options.now ? { now: options.now } : {}) });
  return { port, descriptor: pairing.descriptor(), status, paired: () => pairing.isApproved(), close: async () => { pairing.invalidate(); await manager?.close(); manager = null; await new Promise<void>((ok, reject) => server.close((cause) => cause ? reject(cause) : ok())); } };
}
