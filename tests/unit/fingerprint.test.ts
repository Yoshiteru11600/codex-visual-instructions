import { describe, expect, it } from "vitest";
import { fingerprintElement, resolveFingerprint } from "../../src/core/fingerprint";

describe("ElementFingerprint", () => {
  it("prefers stable attributes and resolves them", () => {
    document.body.innerHTML = '<button data-testid="save">Save now</button>';
    const button = document.querySelector("button")!; const fingerprint = fingerprintElement(button);
    expect(fingerprint.testId).toBe("save"); expect(fingerprint.textSnippet).toBe("Save now");
    expect(resolveFingerprint(fingerprint)).toBe(button);
  });
  it("does not capture password values", () => {
    document.body.innerHTML = '<input type="password" value="secret">';
    expect(fingerprintElement(document.querySelector("input")!).textSnippet).toBeUndefined();
  });
});
