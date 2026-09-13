import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../src/core/config";

describe("mergeConfig", () => {
  it("uses project values over local preferences and keeps privacy disabled", () => {
    const result = mergeConfig({ locale: "fr", shortcuts: { "review.toggle": "Alt+R" } }, { locale: "ja", review: { defaultViewport: "mobile" }, privacy: { telemetry: false } });
    expect(result.locale).toBe("ja");
    expect(result.review.defaultViewport).toBe("mobile");
    expect(result.shortcuts["review.toggle"]).toBe("Alt+R");
    expect(result.privacy.telemetry).toBe(false);
  });
});
