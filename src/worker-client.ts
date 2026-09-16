import type { BridgeErrorBody, BridgeStatus, ReviewSession, ReviewTask, ReviewTaskEvent, WorkerBridgeConfig } from "./types";
import { BridgeClientError } from "./pairing-client";

const headers = (config: WorkerBridgeConfig, stateChanging = false): HeadersInit => ({
  authorization: `Bearer ${config.capabilityToken}`,
  ...(stateChanging ? { "content-type": "application/json", "x-codex-visual-csrf": config.capabilityToken } : {}),
});

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  let message = `Local Bridge returned ${response.status}`;
  let code = "protocol_error";
  try { const body = await response.json() as Partial<BridgeErrorBody> & { error?: string }; message = body.message ?? body.error ?? message; code = body.code ?? code; } catch { /* use status */ }
  throw new BridgeClientError(code, message, response.status);
}

export class ReviewWorkerClient {
  constructor(private readonly config: WorkerBridgeConfig) {}

  async status(): Promise<BridgeStatus> {
    const response = await checked(await fetch(`${this.config.endpoint}/status`, { headers: headers(this.config) }));
    return response.json() as Promise<BridgeStatus>;
  }

  async createTask(session: ReviewSession): Promise<ReviewTask> {
    const response = await checked(await fetch(`${this.config.endpoint}/review-tasks`, {
      method: "POST", headers: headers(this.config, true), body: JSON.stringify({ session }),
    }));
    return response.json() as Promise<ReviewTask>;
  }

  async stream(taskId: string, onEvent: (event: ReviewTaskEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await checked(await fetch(`${this.config.endpoint}/review-tasks/${encodeURIComponent(taskId)}/events`, {
      headers: headers(this.config), ...(signal ? { signal } : {}),
    }));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Local Bridge response has no stream");
    const decoder = new TextDecoder(); let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as ReviewTaskEvent);
      if (done) break;
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as ReviewTaskEvent);
  }

  async cancel(taskId: string): Promise<ReviewTask> {
    const signal = AbortSignal.timeout(10_000);
    const response = await checked(await fetch(`${this.config.endpoint}/review-tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST", headers: headers(this.config, true), body: "{}", signal,
    }));
    return response.json() as Promise<ReviewTask>;
  }
}
