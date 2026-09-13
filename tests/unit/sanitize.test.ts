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
  it("removes active behavior while preserving visual resources and links", () => {
    document.documentElement.innerHTML = `<head>
      <base href="https://evil.test/"><link rel="stylesheet" href="https://evil.test/x.css">
      <meta http-equiv="refresh" content="0;url=https://evil.test/"><style>.x{background:url(https://evil.test/x.png)}@import "https://evil.test/x.css";</style>
    </head><body><iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x">
      <form action="https://evil.test"><img src="x" srcset="y 2x" onerror="steal()"><a href="https://evil.test" ping="https://evil.test/p">go</a><video poster="x"></video></form>
    </body>`;
    const snapshot = sanitizeSnapshot(document.documentElement);
    const parsed = new DOMParser().parseFromString(snapshot, "text/html");
    expect(parsed.querySelector("meta[http-equiv=refresh], iframe, object, embed, form")).toBeNull();
    expect(parsed.querySelector("[ping], [action], [onerror]")).toBeNull();
    expect(parsed.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe("https://evil.test/x.css");
    expect(parsed.querySelector("img")?.getAttribute("src")).toBe("x");
    expect(parsed.querySelector("a")?.getAttribute("href")).toBe("https://evil.test");
    expect(parsed.querySelector("style")?.textContent).toContain("url(https://evil.test/x.png)");
    expect(parsed.body.textContent).toContain("go");
  });
});
