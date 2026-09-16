import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewWorkerClient } from "../../src/worker-client";

describe("ReviewWorkerClient cancellation", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("returns the Bridge-confirmed cancelled task", async () => {
    const task = { id: "task", reviewSessionId: "review", status: "cancelled", messages: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(task), { status: 200 })));
    await expect(new ReviewWorkerClient({ endpoint: "http://127.0.0.1:1", capabilityToken: "token" }).cancel("task")).resolves.toEqual(task);
  });

  it("rejects HTTP failures instead of claiming cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "interrupt failed" }), { status: 500 })));
    await expect(new ReviewWorkerClient({ endpoint: "http://127.0.0.1:1", capabilityToken: "token" }).cancel("task")).rejects.toThrow("interrupt failed");
  });

  it("times out an unresponsive cancellation request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })));
    const cancellation = new ReviewWorkerClient({ endpoint: "http://127.0.0.1:1", capabilityToken: "token" }).cancel("task");
    const assertion = expect(cancellation).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000); await assertion;
  });
});
