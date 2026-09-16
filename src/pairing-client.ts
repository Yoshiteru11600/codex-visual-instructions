import type { BridgeErrorBody, BridgePairingDescriptor, BridgePairingPreview, BridgeStatus, WorkerBridgeConfig } from "./types";

export class BridgeClientError extends Error { constructor(readonly code: string, message: string, readonly status?: number) { super(message); } }
export function parsePairingDescriptor(text: string, currentOrigin = location.origin, now = Date.now()): BridgePairingDescriptor {
  let value: unknown; try { value = JSON.parse(text); } catch { throw new BridgeClientError("invalid_descriptor", "Pairing information is not valid JSON"); }
  const item = value as Partial<BridgePairingDescriptor>;
  if (item.version !== 1 || !item.endpoint || !item.pairingToken || !item.allowedOrigin || !item.workspace || !item.expiresAt) throw new BridgeClientError("invalid_descriptor", "Pairing information is incomplete");
  let endpoint: URL; try { endpoint = new URL(item.endpoint); } catch { throw new BridgeClientError("invalid_descriptor", "Bridge endpoint is invalid"); }
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new BridgeClientError("invalid_descriptor", "Bridge endpoint must be an explicit 127.0.0.1 HTTP port");
  if (!Number.isInteger(Number(endpoint.port)) || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535) throw new BridgeClientError("invalid_descriptor", "Bridge port is invalid");
  let allowedOrigin: string; try { const url = new URL(item.allowedOrigin); if (url.origin !== item.allowedOrigin || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error(); allowedOrigin = url.origin; } catch { throw new BridgeClientError("invalid_descriptor", "Allowed origin is invalid"); }
  if (allowedOrigin !== currentOrigin) throw new BridgeClientError("origin_mismatch", `Current origin ${currentOrigin} does not match ${allowedOrigin}`);
  if (!Number.isFinite(Date.parse(item.expiresAt)) || now >= Date.parse(item.expiresAt)) throw new BridgeClientError("pairing_expired", "Pairing information has expired");
  return item as BridgePairingDescriptor;
}
const checked = async (response: Response): Promise<Response> => { if (response.ok) return response; let body: Partial<BridgeErrorBody> = {}; try { body = await response.json(); } catch { /* use status */ } throw new BridgeClientError(body.code ?? "protocol_error", body.message ?? `Local Bridge returned ${response.status}`, response.status); };
export class PairingClient {
  constructor(private readonly descriptor: BridgePairingDescriptor) {}
  private headers(csrf = false): HeadersInit { return { authorization: `Bearer ${this.descriptor.pairingToken}`, ...(csrf ? { "content-type": "application/json", "x-codex-visual-csrf": this.descriptor.pairingToken } : {}) }; }
  async preview(): Promise<BridgePairingPreview> { return checked(await fetch(`${this.descriptor.endpoint}/pairing`, { headers: this.headers() })).then((r) => r.json()); }
  async approve(): Promise<{ connection: WorkerBridgeConfig; status: BridgeStatus }> { const result = await checked(await fetch(`${this.descriptor.endpoint}/pairing/approve`, { method: "POST", headers: this.headers(true), body: "{}" })).then((r) => r.json()) as { capabilityToken: string; status: BridgeStatus }; return { connection: { endpoint: this.descriptor.endpoint, capabilityToken: result.capabilityToken }, status: result.status }; }
}
