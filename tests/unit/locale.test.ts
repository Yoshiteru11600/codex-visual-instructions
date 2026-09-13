import { describe, expect, it } from "vitest";
import { resolveLocale } from "../../src/locales";

describe("resolveLocale", () => {
  it.each([["ja-JP", "ja"], ["fr-CA", "fr"], ["ru", "ru"], ["de-DE", "en"]] as const)("maps %s to %s", (input, expected) => {
    expect(resolveLocale("auto", input)).toBe(expected);
  });
});
