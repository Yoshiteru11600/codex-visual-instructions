import { describe, expect, it } from "vitest";
import { sanitizeElementMetadata, sanitizeSnapshot } from "../../src/core/sanitize";

describe("sanitization", () => {
  it("removes secrets and executable scripts from snapshots", () => {
    document.documentElement.innerHTML = '<head></head><body><script>steal()</script><input name="api_token" value="abc"><textarea>private</textarea></body>';
    const snapshot = sanitizeSnapshot(document.documentElement);
    expect(snapshot).not.toContain("steal"); expect(snapshot).not.toContain("abc"); expect(snapshot).not.toContain("private");
  });
  it("only returns a narrow attribute allowlist", () => {
    const input = document.createElement("input"); input.setAttribute("value", "private"); input.setAttribute("aria-label", "Email");
    expect(sanitizeElementMetadata(input)).toEqual({ "aria-label": "Email" });
  });
});
