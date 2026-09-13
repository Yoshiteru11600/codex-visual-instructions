import { afterEach, describe, expect, it } from "vitest";
import { install } from "../../src";

describe("session serialization", () => {
  afterEach(() => document.querySelector("[data-codex-visual-instructions]")?.remove());
  it("creates a versioned local session with implementation guidance", () => {
    const handle = install(); const value = JSON.parse(handle.serialize());
    expect(value.version).toBe(1); expect(value.sessionId).toMatch(/^review-/);
    expect(value.implementationInstruction).toContain("visual specifications");
    handle.destroy();
  });
});
