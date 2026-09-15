import type { ReviewSession, ReviewTask, ReviewTaskEvent, WorkerBridgeConfig } from "./types";

const headers = (config: WorkerBridgeConfig, stateChanging = false): HeadersInit => ({
  authorization: `Bearer ${config.capabilityToken}`,
  ...(stateChanging ? { "content-type": "application/json", "x-codex-visual-csrf": config.capabilityToken } : {}),
});

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  let message = `Local Bridge returned ${response.status}`;
  try { message = (await response.json() as { error?: string }).error ?? message; } catch { /* use status */ }
  throw new Error(message);
}

export class ReviewWorkerClient {
  constructor(private readonly config: WorkerBridgeConfig) {}

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

  async cancel(taskId: string): Promise<void> {
    await checked(await fetch(`${this.config.endpoint}/review-tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST", headers: headers(this.config, true), body: "{}",
    }));
  }
}
