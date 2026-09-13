import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/examples/vanilla/");
  await page.locator("[data-codex-visual-instructions]").waitFor({ state: "attached" });
});

test("installs, selects, nudges, edits, undoes, and blocks navigation", async ({ page }) => {
  await page.evaluate(() => (window as typeof window & { visualReview: { start(): void } }).visualReview.start());
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.evaluate(() => (window as any).visualReview.session.annotations[0]?.operation.type)).toBe("move");
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => {
    const input = host.shadowRoot.querySelector("[data-text-input]"); input.value = "A precise visual review.";
    host.shadowRoot.querySelector('[data-action="text"]').click();
  });
  await expect(page.getByTestId("hero-title")).toHaveText("A precise visual review.");
  await page.evaluate(() => (window as any).visualReview.undo());
  await expect(page.getByTestId("hero-title")).toContainText("A calmer way");
  await page.evaluate(() => (window as any).visualReview.redo());
  await expect(page.getByTestId("hero-title")).toHaveText("A precise visual review.");
  await page.getByTestId("hero-title").click();
  const navigationAllowed = await page.locator("#pricing-link").evaluate((link) =>
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
  );
  expect(navigationAllowed).toBe(false);
  await expect(page).toHaveURL(/examples\/vanilla/);
});

test("supports multi-select, hide, compare and locale controls", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.locator(".actions button").nth(0).click();
  await page.locator(".actions button").nth(1).click({ modifiers: ["Shift"] });
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => {
    host.shadowRoot.querySelector('[data-action="hide"]').click();
    const compare = host.shadowRoot.querySelector("[data-compare]"); compare.value = "side-by-side"; compare.dispatchEvent(new Event("change"));
    const locale = host.shadowRoot.querySelector("[data-locale]"); locale.value = "ja"; locale.dispatchEvent(new Event("change"));
  });
  await expect.poll(() => page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(2);
  await expect.poll(() => page.locator("[data-codex-visual-instructions]").evaluate((host: any) => !host.shadowRoot.querySelector("iframe").hidden)).toBe(true);
});

test("records mouse drag and resize as visual deltas", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const target = page.locator("#intro");
  await target.click();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 12, box!.y + 12);
  await page.mouse.down();
  await page.mouse.move(box!.x + 42, box!.y + 22);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).visualReview.session.annotations.at(-1)?.operation.type)).toBe("move");
  const resize = page.locator("[data-codex-visual-instructions] .resize");
  const handle = await resize.boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + 5, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 35, handle!.y + 20);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).visualReview.session.annotations.at(-1)?.operation.type)).toBe("resize");
});

test("requires a warning and high-risk metadata for remove previews", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.locator("#intro").click();
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelector('[data-action="remove"]').click());
  await expect.poll(() => page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelector("dialog").open)).toBe(true);
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelector('[data-action="confirm-remove"]').click());
  const result = await page.evaluate(() => {
    const item = (window as any).visualReview.session.annotations.at(-1);
    return { type: item.operation.type, risk: item.risk, required: item.verificationRequired, display: document.querySelector<HTMLElement>("#intro")!.style.display };
  });
  expect(result).toEqual({ type: "remove", risk: "high", required: true, display: "none" });
});

test("switches original/overlay modes, viewport guides, and configured shortcuts", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => {
    const compare = host.shadowRoot.querySelector("[data-compare]"); compare.value = "overlay"; compare.dispatchEvent(new Event("change"));
    const viewport = host.shadowRoot.querySelector("[data-viewport]"); viewport.value = "mobile"; viewport.dispatchEvent(new Event("change"));
  });
  const state = await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => ({
    frameClass: host.shadowRoot.querySelector("iframe").className,
    guideHidden: host.shadowRoot.querySelector(".guide").hidden,
  }));
  expect(state.frameClass).toContain("overlay"); expect(state.guideHidden).toBe(false);
  await page.evaluate(async () => {
    (window as any).visualReview.destroy();
    const modulePath = "/dist/index.js";
    const { install } = await import(modulePath);
    (window as any).visualReview = install({ config: { shortcuts: { "review.toggle": "Alt+Q" } } });
  });
  await page.keyboard.press("Alt+Q");
  await expect.poll(() => page.evaluate(() => (window as any).visualReview.active)).toBe(true);
});
