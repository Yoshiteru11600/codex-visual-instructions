import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, findShortcutConflicts, normalizeShortcut } from "../../src/core/commands/registry";

describe("commands and shortcuts", () => {
  it("keeps command ids independent from shortcut text", () => {
    const registry = new CommandRegistry(); const handler = vi.fn(); registry.register("review.toggle", handler);
    expect(registry.execute("review.toggle")).toBe(true); expect(handler).toHaveBeenCalledOnce();
  });
  it("normalizes and reports conflicts", () => {
    expect(normalizeShortcut("Shift + Alt + R")).toBe("alt+shift+r");
    const conflicts = findShortcutConflicts({ a: "Ctrl+L", b: "control+l" });
    expect(conflicts).toContain("b conflicts with a");
    expect(conflicts.filter((item) => item.includes("browser shortcut"))).toHaveLength(2);
  });
});
