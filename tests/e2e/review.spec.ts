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

test("clear cancels an in-progress resize without recording it", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const target = page.locator("#intro");
  await target.click();
  const handle = await page.locator("[data-codex-visual-instructions] .resize").boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + 5, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 45, handle!.y + 30);
  await expect(target).toHaveAttribute("style", /width:/);
  await page.evaluate(() => (window as any).visualReview.clear());
  await page.mouse.up();
  expect(await target.getAttribute("style")).toBeNull();
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(0);
});

test("destroy cancels an in-progress resize and removes the overlay", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const target = page.locator("#intro");
  await target.click();
  const handle = await page.locator("[data-codex-visual-instructions] .resize").boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + 5, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 45, handle!.y + 30);
  await expect(target).toHaveAttribute("style", /height:/);
  await page.evaluate(() => (window as any).visualReview.destroy());
  await page.mouse.up();
  expect(await target.getAttribute("style")).toBeNull();
  await expect(page.locator("[data-codex-visual-instructions]")).toHaveCount(0);
});

test("Escape cancels an in-progress drag without undoing committed history", async ({ page }) => {
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>("#intro")!;
    target.style.transform = "rotate(3deg)";
    (window as any).visualReview.start();
  });
  const target = page.locator("#intro");
  await target.click();
  const beforeBox = await target.boundingBox();
  const beforeStyle = await target.getAttribute("style");
  expect(beforeBox).not.toBeNull();
  await page.mouse.move(beforeBox!.x + 20, beforeBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(beforeBox!.x + 60, beforeBox!.y + 45);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await target.getAttribute("style")).toBe(beforeStyle);
  const afterBox = await target.boundingBox();
  expect(afterBox!.x).toBeCloseTo(beforeBox!.x, 0);
  expect(afterBox!.y).toBeCloseTo(beforeBox!.y, 0);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(0);
  expect(await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelectorAll(".selection").length)).toBe(0);
});

test("Escape cancels an in-progress resize and clears selection", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const target = page.locator("#intro");
  await target.click();
  const beforeBox = await target.boundingBox();
  const handle = await page.locator("[data-codex-visual-instructions] .resize").boundingBox();
  expect(beforeBox).not.toBeNull();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + 5, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 45, handle!.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await target.getAttribute("style")).toBeNull();
  const afterBox = await target.boundingBox();
  expect(afterBox!.width).toBeCloseTo(beforeBox!.width, 0);
  expect(afterBox!.height).toBeCloseTo(beforeBox!.height, 0);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(0);
  expect(await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelectorAll(".selection").length)).toBe(0);
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

test("renders page metadata as text and preserves existing transforms", async ({ page }) => {
  await page.evaluate(() => {
    const target = document.createElement("a");
    target.id = "hostile-metadata";
    target.href = `javascript:"><img src=x onerror=alert(1)>`;
    target.textContent = `<img src=x onerror=alert(1)> & < > " '`;
    target.style.cssText = "display:block;width:240px;height:40px;transform:translateX(-50%) rotate(5deg)";
    document.body.prepend(target);
    (window as any).visualReview.start();
  });
  await page.locator("#hostile-metadata").click();
  const metadata = await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => {
    const meta = host.shadowRoot.querySelector("[data-meta]");
    return { text: meta.textContent, injectedImages: meta.querySelectorAll("img").length };
  });
  expect(metadata.injectedImages).toBe(0);
  expect(metadata.text).toContain("<img src=x onerror=alert(1)>");
  const original = await page.locator("#hostile-metadata").getAttribute("style");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#hostile-metadata")).toHaveCSS("transform", /matrix/);
  await page.evaluate(() => (window as any).visualReview.undo());
  expect(await page.locator("#hostile-metadata").getAttribute("style")).toBe(original);

  await page.evaluate(() => {
    const style = document.createElement("style"); style.textContent = ".computed-transform { transform: scale(1.1) rotate(3deg); }";
    const target = document.createElement("div"); target.id = "computed-transform"; target.className = "computed-transform"; target.textContent = "Computed";
    document.head.append(style); document.body.prepend(target);
  });
  const beforeComputed = await page.locator("#computed-transform").evaluate((element) => getComputedStyle(element).transform);
  await page.locator("#computed-transform").evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => (window as any).visualReview.clear());
  expect(await page.locator("#computed-transform").getAttribute("style")).toBeNull();
  expect(await page.locator("#computed-transform").evaluate((element) => getComputedStyle(element).transform)).toBe(beforeComputed);
});

test("uses configured initial comparison and edits only an unambiguous direct text node", async ({ page }) => {
  await page.evaluate(async () => {
    (window as any).visualReview.destroy();
    const modulePath = "/dist/index.js";
    const { install } = await import(modulePath);
    (window as any).visualReview = install({ startActive: true, config: { review: { defaultCompareMode: "overlay" } } });
    const button = document.createElement("button");
    button.id = "icon-button";
    button.innerHTML = "<svg data-icon></svg>Save";
    document.body.prepend(button);
  });
  const frameClass = await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelector("iframe").className);
  expect(frameClass).toContain("overlay");
  await page.locator("#icon-button").evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => {
    const input = host.shadowRoot.querySelector("[data-text-input]"); input.value = "Store";
    host.shadowRoot.querySelector('[data-action="text"]').click();
  });
  await expect(page.locator("#icon-button [data-icon]")).toHaveCount(1);
  await expect(page.locator("#icon-button")).toContainText("Store");

  await page.evaluate(() => {
    const complex = document.createElement("div"); complex.id = "complex-text";
    complex.innerHTML = "<span>Title</span><small>Sub</small>";
    document.body.prepend(complex);
  });
  await page.locator("#complex-text").evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  const disabled = await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelector('[data-action="text"]').disabled);
  expect(disabled).toBe(true);
});
