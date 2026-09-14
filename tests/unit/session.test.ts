import { afterEach, describe, expect, it, vi } from "vitest";
import { install } from "../../src";
import type { ReviewInstruction } from "../../src";

const instruction = (id = "instruction-1", resolved = false): ReviewInstruction => ({
  id,
  target: { tagName: "DIV" },
  operation: { type: "hide", intent: "not-visible" },
  intent: "visibility",
  comment: "Hide this visual element",
  precision: "intent-only",
  viewport: { width: 1000, height: 800, devicePixelRatio: 1, preset: "desktop" },
  applyScope: "current-viewport",
  risk: "medium",
  verificationRequired: false,
  implementationRequirements: [],
  resolved,
  createdAt: "2026-09-14T00:00:00.000Z",
});

describe("session serialization", () => {
  afterEach(() => document.querySelector("[data-codex-visual-instructions]")?.remove());
  it("creates a versioned local session with implementation guidance", () => {
    const handle = install(); const value = JSON.parse(handle.serialize());
    expect(value.version).toBe(1); expect(value.sessionId).toMatch(/^review-/);
    expect(value.status).toBe("draft"); expect(value.confirmedAt).toBeUndefined();
    expect(value.summary).toEqual({ total: 0, pending: 0, resolved: 0, byOperation: {} });
    expect(value.implementationInstruction).toContain("visual specifications");
    handle.destroy();
  });
  it("confirms a session with pending instructions, persists its summary, and returns to draft after a specification edit", () => {
    const handle = install({ storageKey: "handoff-test" });
    handle.session.annotations.push(instruction());
    expect(handle.confirm()).toBe(true);
    expect(handle.session.status).toBe("ready");
    expect(handle.session.confirmedAt).toBeTruthy();
    expect(handle.session.summary).toEqual({ total: 1, pending: 1, resolved: 0, byOperation: { hide: 1 } });
    expect(JSON.parse(localStorage.getItem("handoff-test") ?? "null").status).toBe("ready");

    handle.start();
    const host = document.querySelector<HTMLElement>("[data-codex-visual-instructions]")!;
    const comment = host.shadowRoot!.querySelector<HTMLTextAreaElement>("[data-comment]")!;
    comment.value = "Updated intent";
    comment.dispatchEvent(new Event("input", { bubbles: true }));
    expect(handle.session.status).toBe("draft");
    expect(handle.session.confirmedAt).toBeUndefined();
    handle.destroy();
  });
  it("does not confirm a session without instructions", () => {
    const handle = install({ storageKey: "empty-handoff-test" });
    expect(handle.confirm()).toBe(false);
    expect(handle.session.status).toBe("draft");
    expect(localStorage.getItem("empty-handoff-test")).toBeNull();
    handle.destroy();
  });
  it("confirms mixed pending and resolved instructions and preserves the summary invariant", () => {
    const handle = install();
    handle.session.annotations.push(instruction("pending-1"), instruction("resolved-1", true), instruction("pending-2"));
    expect(handle.confirm()).toBe(true);
    expect(handle.session.summary).toEqual({ total: 3, pending: 2, resolved: 1, byOperation: { hide: 3 } });
    expect(handle.session.summary.total).toBe(handle.session.summary.pending + handle.session.summary.resolved);
    handle.destroy();
  });
  it("keeps a confirmed all-resolved session ready and shows completion", () => {
    const handle = install();
    handle.session.annotations.push(instruction("resolved-1"), instruction("resolved-2"), instruction("resolved-3"));
    expect(handle.confirm()).toBe(true);
    const confirmedAt = handle.session.confirmedAt;
    handle.session.annotations.forEach((item) => { item.resolved = true; });
    expect(handle.confirm()).toBe(false);
    expect(handle.session.status).toBe("ready");
    expect(handle.session.confirmedAt).toBe(confirmedAt);
    expect(handle.session.summary).toMatchObject({ total: 3, pending: 0, resolved: 3 });
    handle.start();
    const shadow = document.querySelector<HTMLElement>("[data-codex-visual-instructions]")!.shadowRoot!;
    const button = shadow.querySelector<HTMLButtonElement>('[data-action="handoff"]')!;
    expect(button.disabled).toBe(true);
    expect(shadow.querySelector("[data-handoff-status]")?.textContent).toBe("✓ All instructions resolved");
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
