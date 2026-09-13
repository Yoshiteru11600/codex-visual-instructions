import { afterEach, describe, expect, it, vi } from "vitest";
import { install } from "../../src";

describe("session serialization", () => {
  afterEach(() => document.querySelector("[data-codex-visual-instructions]")?.remove());
  it("creates a versioned local session with implementation guidance", () => {
    const handle = install(); const value = JSON.parse(handle.serialize());
    expect(value.version).toBe(1); expect(value.sessionId).toMatch(/^review-/);
    expect(value.implementationInstruction).toContain("visual specifications");
    handle.destroy();
  });
  it("keeps clear storage empty instead of immediately saving an empty session", () => {
    const handle = install({ storageKey: "review-test" });
    handle.clear();
    expect(localStorage.getItem("review-test")).toBeNull();
    handle.destroy();
  });
  it("unregisters Site Tools when destroy happens during async registration", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const registerTool = vi.fn().mockReturnValueOnce(pending);
    const unregisterTool = vi.fn();
    Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool, unregisterTool } });
    const handle = install();
    handle.destroy();
    release();
    await pending;
    await vi.waitFor(() => expect(unregisterTool).toHaveBeenCalledTimes(5));
    Object.defineProperty(document, "modelContext", { configurable: true, value: undefined });
  });
  it("removes every installed scroll listener after repeated comparison loads", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const handle = install({ config: { review: { defaultCompareMode: "original" } } });
    const frame = document.querySelector<HTMLElement>("[data-codex-visual-instructions]")!.shadowRoot!.querySelector("iframe")!;
    frame.dispatchEvent(new Event("load"));
    frame.dispatchEvent(new Event("load"));
    const addedScrollHandlers = add.mock.calls.filter(([type]) => type === "scroll").map(([, handler]) => handler);
    handle.destroy();
    const removedScrollHandlers = remove.mock.calls.filter(([type]) => type === "scroll").map(([, handler]) => handler);
    for (const handler of new Set(addedScrollHandlers)) expect(removedScrollHandlers).toContain(handler);
    add.mockRestore(); remove.mockRestore();
  });
});
