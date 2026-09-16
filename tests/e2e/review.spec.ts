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

test("confirms a pending session and returns to draft after editing", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]");
  expect(await host.evaluate((element: any) => element.shadowRoot.querySelector('[data-action="handoff"]').disabled)).toBe(true);

  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  expect(await host.evaluate((element: any) => element.shadowRoot.querySelector('[data-action="handoff"]').disabled)).toBe(false);
  await host.evaluate((element: any) => element.shadowRoot.querySelector('[data-action="handoff"]').click());

  await expect.poll(() => page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt);
  expect(confirmedAt).toBeTruthy();
  expect(await page.evaluate(() => (window as any).visualReview.session.summary)).toEqual({ total: 1, pending: 1, resolved: 0, byOperation: { move: 1 } });

  await host.evaluate((element: any) => {
    const compare = element.shadowRoot.querySelector("[data-compare]");
    compare.value = "overlay";
    compare.dispatchEvent(new Event("change"));
  });
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);

  await host.evaluate((element: any) => {
    const comment = element.shadowRoot.querySelector("[data-comment]");
    comment.value = "Keep more room around the title";
    comment.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).visualReview.session.status)).toBe("draft");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBeUndefined();
});

test("starts the local worker only after explicit confirmation and renders its reply", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.route("http://127.0.0.1:9321/pairing", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint: "http://127.0.0.1:9321", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z", readiness: { status: "ready" }, activeTask: false }) }));
  await page.route("http://127.0.0.1:9321/pairing/approve", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ capabilityToken: "test-token", status: { workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false } }) }));
  await page.route("http://127.0.0.1:9321/review-tasks", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    expect(route.request().headers()["x-codex-visual-csrf"]).toBe("test-token");
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "task-1", reviewSessionId: "review", status: "queued", messages: [] }) });
  });
  await page.route("http://127.0.0.1:9321/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false }) }));
  await page.route("http://127.0.0.1:9321/review-tasks/task-1/events", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: [
      { type: "agent-message-delta", itemId: "message-1", delta: "Implemented " },
      { type: "agent-message-delta", itemId: "message-1", delta: "the change." },
      { type: "agent-message-delta", itemId: "message-2", delta: "Checks passed." },
      { type: "status", status: "completed" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
  const host = page.locator("[data-codex-visual-instructions]");
  const ask = host.locator('[data-action="worker-request"]');
  await expect(ask).toBeDisabled();
  await page.getByTestId("hero-title").click(); await page.keyboard.press("ArrowRight");
  await host.locator('[data-action="handoff"]').click(); await expect(ask).toBeEnabled();
  await ask.click(); const pairing = host.locator("[data-pairing-dialog]"); await pairing.locator("[data-pairing-input]").fill(JSON.stringify({ version: 1, endpoint: "http://127.0.0.1:9321", pairingToken: "pair", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z" })); await pairing.locator('[data-action="check-pairing"]').click(); await pairing.locator('[data-action="approve-pairing"]').click(); await expect(ask).toBeDisabled();
  await host.locator('[data-action="end-review"]').click();
  await expect(host.locator("[data-end-warning]")).toContainText("Codex is still working");
  await expect(host.locator('[data-action="cancel-worker-end"]')).toBeVisible();
  await host.locator('[data-action="cancel-end"]').click();
  await expect(host.locator("[data-worker-status]")).toHaveText("Completed");
  await expect(host.locator(".worker-message")).toHaveText(["Implemented the change.", "Checks passed."]);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(1);
});

test("pairs explicitly before starting a worker and keeps the ready session", async ({ page }) => {
  const endpoint = "http://127.0.0.1:9322"; const pairingToken = "pairing-secret"; const runtimeToken = "runtime-secret";
  await page.route(`${endpoint}/pairing`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint, allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\workspace\\app", expiresAt: "2030-01-01T00:00:00.000Z", readiness: { status: "ready" }, activeTask: false }) }));
  await page.route(`${endpoint}/pairing/approve`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ capabilityToken: runtimeToken, status: { workspace: "C:\\workspace\\app", readiness: { status: "ready" }, state: "running", activeTask: false } }) }));
  await page.route(`${endpoint}/status`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace: "C:\\workspace\\app", readiness: { status: "ready" }, state: "running", activeTask: false }) }));
  await page.route(`${endpoint}/review-tasks`, async (route) => { expect(route.request().headers().authorization).toBe(`Bearer ${runtimeToken}`); await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "paired-task", reviewSessionId: "review", status: "queued", messages: [] }) }); });
  await page.route(`${endpoint}/review-tasks/paired-task/events`, (route) => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "status", status: "completed" })}\n` }));
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]"); await page.getByTestId("hero-title").click(); await page.keyboard.press("ArrowRight"); await host.locator('[data-action="handoff"]').click();
  await expect(host.locator("[data-bridge-status]")).toContainText("not connected"); await host.locator('[data-action="worker-request"]').click();
  const dialog = host.locator("[data-pairing-dialog]"); await expect(dialog).toBeVisible(); expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  await dialog.locator("[data-pairing-input]").fill(JSON.stringify({ version: 1, endpoint, pairingToken, allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\workspace\\app", expiresAt: "2030-01-01T00:00:00.000Z" }));
  await dialog.locator('[data-action="check-pairing"]').click(); await expect(dialog.locator("[data-pairing-summary]")).toContainText("C:\\workspace\\app");
  await dialog.locator('[data-action="approve-pairing"]').click(); await expect(dialog).toBeHidden(); await expect(host.locator("[data-worker-status]")).toHaveText("Completed");
  await expect(host.locator("[data-bridge-status]")).toContainText("connected"); expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
});

for (const status of [401, 403]) test(`drops an invalid runtime token after HTTP ${status} and returns to pairing without losing the review`, async ({ page }) => {
  const endpoint = "http://127.0.0.1:9323";
  await page.route(`${endpoint}/pairing`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint, allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z", readiness: { status: "ready" }, activeTask: false }) }));
  await page.route(`${endpoint}/pairing/approve`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ capabilityToken: "old-runtime", status: { workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false } }) }));
  await page.route(`${endpoint}/status`, (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: "invalid_token", message: "Invalid capability token" }) }));
  await page.evaluate(() => (window as any).visualReview.start()); const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click(); await page.keyboard.press("ArrowRight"); await host.locator('[data-action="handoff"]').click(); await host.locator('[data-action="worker-request"]').click();
  const dialog = host.locator("[data-pairing-dialog]"); await dialog.locator("[data-pairing-input]").fill(JSON.stringify({ version: 1, endpoint, pairingToken: "pair", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z" })); await dialog.locator('[data-action="check-pairing"]').click(); await dialog.locator('[data-action="approve-pairing"]').click();
  await expect(dialog).toBeVisible(); await expect(host.locator("[data-bridge-status]")).toContainText("expired");
  expect(await page.evaluate(() => ({ status: (window as any).visualReview.session.status, count: (window as any).visualReview.session.annotations.length }))).toEqual({ status: "ready", count: 1 });
});

test("drops an unreachable bridge connection and offers pairing without losing the review", async ({ page }) => {
  const endpoint = "http://127.0.0.1:9324";
  await page.route(`${endpoint}/pairing`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint, allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z", readiness: { status: "ready" }, activeTask: false }) }));
  await page.route(`${endpoint}/pairing/approve`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ capabilityToken: "old-runtime", status: { workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false } }) }));
  await page.route(`${endpoint}/status`, (route) => route.abort("connectionrefused"));
  await page.evaluate(() => (window as any).visualReview.start()); const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click(); await page.keyboard.press("ArrowRight"); await host.locator('[data-action="handoff"]').click(); await host.locator('[data-action="worker-request"]').click();
  const dialog = host.locator("[data-pairing-dialog]"); await dialog.locator("[data-pairing-input]").fill(JSON.stringify({ version: 1, endpoint, pairingToken: "pair", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z" })); await dialog.locator('[data-action="check-pairing"]').click(); await dialog.locator('[data-action="approve-pairing"]').click();
  await expect(dialog).toBeVisible(); await expect(host.locator("[data-bridge-status]")).toContainText("cannot be reached");
  expect(await page.evaluate(() => ({ status: (window as any).visualReview.session.status, count: (window as any).visualReview.session.annotations.length }))).toEqual({ status: "ready", count: 1 });
});

for (const streamFailure of ["network", 401, 403] as const) test(`re-pairs with a new runtime token after the task stream fails with ${streamFailure}`, async ({ page }) => {
  const endpoint = "http://127.0.0.1:9325"; let approvals = 0; const taskTokens: string[] = [];
  await page.route(`${endpoint}/pairing`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint, allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z", readiness: { status: "ready" }, activeTask: false }) }));
  await page.route(`${endpoint}/pairing/approve`, (route) => { approvals += 1; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ capabilityToken: approvals === 1 ? "old-runtime" : "new-runtime", status: { workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false } }) }); });
  await page.route(`${endpoint}/status`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false }) }));
  await page.route(`${endpoint}/review-tasks`, (route) => { const token = route.request().headers().authorization ?? ""; taskTokens.push(token); return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: taskTokens.length === 1 ? "old-task" : "new-task", reviewSessionId: "review", status: "queued", messages: [] }) }); });
  await page.route(`${endpoint}/review-tasks/old-task/events`, (route) => streamFailure === "network"
    ? route.abort("connectionrefused")
    : route.fulfill({ status: streamFailure, contentType: "application/json", body: JSON.stringify({ code: "invalid_token", message: "Invalid capability token" }) }));
  await page.route(`${endpoint}/review-tasks/new-task/events`, (route) => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "status", status: "completed" })}\n` }));
  await page.evaluate(() => (window as any).visualReview.start()); const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click(); await page.keyboard.press("ArrowRight"); await host.locator('[data-action="handoff"]').click(); const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt); await host.locator('[data-action="worker-request"]').click();
  const dialog = host.locator("[data-pairing-dialog]"); const descriptor = JSON.stringify({ version: 1, endpoint, pairingToken: "pair", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z" });
  await dialog.locator("[data-pairing-input]").fill(descriptor); await dialog.locator('[data-action="check-pairing"]').click(); await dialog.locator('[data-action="approve-pairing"]').click();
  await expect(dialog).toBeVisible(); await expect(host.locator("[data-worker-status]")).toHaveText("Failed"); await expect(host.locator('[data-action="worker-retry"]')).toBeVisible(); await expect(host.locator(".worker-message").last()).toContainText("task status cannot be confirmed");
  expect(await page.evaluate(() => ({ status: (window as any).visualReview.session.status, confirmedAt: (window as any).visualReview.session.confirmedAt, count: (window as any).visualReview.session.annotations.length }))).toEqual({ status: "ready", confirmedAt, count: 1 });
  await dialog.locator("[data-pairing-input]").fill(descriptor); await dialog.locator('[data-action="check-pairing"]').click(); await dialog.locator('[data-action="approve-pairing"]').click();
  await expect(host.locator("[data-worker-status]")).toHaveText("Completed"); expect(taskTokens).toEqual(["Bearer old-runtime", "Bearer new-runtime"]);
});

test("makes a running task retryable when cancellation loses the bridge", async ({ page }) => {
  const endpoint = "http://127.0.0.1:9326";
  await page.route(`${endpoint}/pairing`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint, allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z", readiness: { status: "ready" }, activeTask: false }) }));
  await page.route(`${endpoint}/pairing/approve`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ capabilityToken: "runtime", status: { workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false } }) }));
  await page.route(`${endpoint}/status`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false }) }));
  await page.route(`${endpoint}/review-tasks`, (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "cancel-task", reviewSessionId: "review", status: "queued", messages: [] }) }));
  await page.route(`${endpoint}/review-tasks/cancel-task/events`, (route) => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "status", status: "inspecting" })}\n` }));
  await page.route(`${endpoint}/review-tasks/cancel-task/cancel`, (route) => route.abort("connectionrefused"));
  await page.evaluate(() => (window as any).visualReview.start()); const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click(); await page.keyboard.press("ArrowRight"); await host.locator('[data-action="handoff"]').click(); await host.locator('[data-action="worker-request"]').click(); const dialog = host.locator("[data-pairing-dialog]"); const descriptor = JSON.stringify({ version: 1, endpoint, pairingToken: "pair", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z" }); await dialog.locator("[data-pairing-input]").fill(descriptor); await dialog.locator('[data-action="check-pairing"]').click(); await dialog.locator('[data-action="approve-pairing"]').click();
  await expect(host.locator("[data-worker-status]")).toHaveText("Working…"); await host.locator('[data-action="worker-cancel"]').click();
  await expect(host.locator("[data-worker-status]")).toHaveText("Failed"); await expect(host.locator('[data-action="worker-retry"]')).toBeVisible(); await expect(host.locator("[data-bridge-status]")).toContainText("cannot be reached"); expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
});

test("keeps the worker active and explains when cancellation cannot be confirmed", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.route("http://127.0.0.1:9321/pairing", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint: "http://127.0.0.1:9321", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z", readiness: { status: "ready" }, activeTask: false }) }));
  await page.route("http://127.0.0.1:9321/pairing/approve", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ capabilityToken: "test-token", status: { workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false } }) }));
  await page.route("http://127.0.0.1:9321/review-tasks", (route) => route.fulfill({
    status: 202, contentType: "application/json", body: JSON.stringify({ id: "task-cancel", reviewSessionId: "review", status: "queued", messages: [] }),
  }));
  await page.route("http://127.0.0.1:9321/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace: "C:\\app", readiness: { status: "ready" }, state: "running", activeTask: false }) }));
  await page.route("http://127.0.0.1:9321/review-tasks/task-cancel/events", (route) => route.fulfill({
    status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "status", status: "inspecting" })}\n`,
  }));
  await page.route("http://127.0.0.1:9321/review-tasks/task-cancel/cancel", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ error: "interrupt failed" }),
  }));
  const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click(); await page.keyboard.press("ArrowRight");
  await host.locator('[data-action="handoff"]').click(); await host.locator('[data-action="worker-request"]').click(); const pairing = host.locator("[data-pairing-dialog]"); await pairing.locator("[data-pairing-input]").fill(JSON.stringify({ version: 1, endpoint: "http://127.0.0.1:9321", pairingToken: "pair", allowedOrigin: "http://127.0.0.1:4173", workspace: "C:\\app", expiresAt: "2030-01-01T00:00:00.000Z" })); await pairing.locator('[data-action="check-pairing"]').click(); await pairing.locator('[data-action="approve-pairing"]').click();
  await expect(host.locator("[data-worker-status]")).toHaveText("Working…");
  await host.locator('[data-action="worker-cancel"]').click();
  await expect(host.locator("[data-worker-status]")).not.toHaveText("Cancelled");
  await expect(host.locator(".worker-message").last()).toContainText("task may still be running");
  await expect(host.locator(".worker-message").last()).toContainText("interrupt failed");
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
  await expect.poll(() => page.locator("[data-codex-visual-instructions]").evaluate((host: any) => !host.shadowRoot.querySelector(".side-compare").hidden)).toBe(true);
});

test("enables selection actions only for the required selection count", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]");
  const actionState = () => host.evaluate((element: any) => ({
    clear: element.shadowRoot.querySelector('[data-action="clear-selection"]').disabled,
    align: element.shadowRoot.querySelector('[data-action="align"]').disabled,
    spacing: element.shadowRoot.querySelector('[data-action="spacing"]').disabled,
  }));

  expect(await actionState()).toEqual({ clear: true, align: true, spacing: true });
  await page.locator(".actions button").nth(0).click();
  expect(await actionState()).toEqual({ clear: false, align: true, spacing: true });
  await page.locator(".actions button").nth(1).click({ modifiers: ["Shift"] });
  expect(await actionState()).toEqual({ clear: false, align: false, spacing: true });
  await page.locator(".actions button").nth(2).click({ modifiers: ["Shift"] });
  expect(await actionState()).toEqual({ clear: false, align: false, spacing: false });
  await host.locator('[data-action="clear-selection"]').click();
  expect(await actionState()).toEqual({ clear: true, align: true, spacing: true });
});

test("moves, clamps, persists, and resets the panel without dragging controls", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const panel = page.locator("[data-codex-visual-instructions] .panel");
  const header = page.locator("[data-codex-visual-instructions] .head");
  const before = await panel.boundingBox();
  const headerBox = await header.boundingBox();
  expect(before).not.toBeNull(); expect(headerBox).not.toBeNull();
  await page.mouse.move(headerBox!.x + 30, headerBox!.y + 15);
  await page.mouse.down(); await page.mouse.move(80, 100); await page.mouse.up();
  const moved = await panel.boundingBox();
  expect(moved!.x).toBeGreaterThanOrEqual(12); expect(moved!.y).toBeGreaterThanOrEqual(12);
  expect(moved!.x).not.toBeCloseTo(before!.x, 0);

  const afterHeaderDrag = { x: moved!.x, y: moved!.y };
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => {
    const button = host.shadowRoot.querySelector(".head button");
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 8, clientX: 20, clientY: 20 }));
    host.shadowRoot.querySelector(".head").dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 8, clientX: 200, clientY: 200 }));
  });
  const afterControl = await panel.boundingBox();
  expect(afterControl!.x).toBeCloseTo(afterHeaderDrag.x, 0); expect(afterControl!.y).toBeCloseTo(afterHeaderDrag.y, 0);

  await page.evaluate(async () => {
    (window as any).visualReview.destroy();
    const modulePath = "/dist/index.js";
    const { install } = await import(modulePath);
    (window as any).visualReview = install({ startActive: true });
  });
  const restored = await panel.boundingBox();
  expect(restored!.x).toBeCloseTo(afterHeaderDrag.x, 0); expect(restored!.y).toBeCloseTo(afterHeaderDrag.y, 0);
  await page.setViewportSize({ width: 360, height: 500 });
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return box!.x + box!.width;
  }).toBeLessThanOrEqual(348.5);
  const clamped = await panel.boundingBox();
  expect(clamped!.x).toBeGreaterThanOrEqual(12);
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => host.shadowRoot.querySelector('[data-action="reset-panel"]').click());
  const reset = await panel.boundingBox();
  expect(reset!.x + reset!.width).toBeCloseTo(348, 0); expect(reset!.y).toBeCloseTo(12, 0);
});

test("keeps UI preferences separate from a ready review session", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => (window as any).visualReview.confirm());
  const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt);
  const header = await page.locator("[data-codex-visual-instructions] .head").boundingBox();
  await page.mouse.move(header!.x + 25, header!.y + 15); await page.mouse.down(); await page.mouse.move(100, 110); await page.mouse.up();
  await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => {
    const root = host.shadowRoot;
    root.querySelector('[data-section="view"]').open = true;
    root.querySelector('[data-section="preferences"]').open = true;
    const panelOpacity = root.querySelector("[data-panel-opacity]"); panelOpacity.value = "72"; panelOpacity.dispatchEvent(new Event("input"));
    const compare = root.querySelector("[data-compare]"); compare.value = "overlay"; compare.dispatchEvent(new Event("change"));
    const compareOpacity = root.querySelector("[data-compare-opacity]"); compareOpacity.value = "35"; compareOpacity.dispatchEvent(new Event("input"));
    const locale = root.querySelector("[data-locale]"); locale.value = "ja"; locale.dispatchEvent(new Event("change"));
  });
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);
  const ui = await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => ({
    panelOpacity: host.shadowRoot.querySelector(".panel").style.getPropertyValue("--panel-opacity"),
    frameOpacity: host.shadowRoot.querySelector("iframe").style.opacity,
    panelCssOpacity: getComputedStyle(host.shadowRoot.querySelector(".panel")).opacity,
    view: host.shadowRoot.querySelector('[data-section="view"] summary').textContent,
    option: host.shadowRoot.querySelector('[data-intent] option[value="spacing"]').textContent,
    dialogCancel: host.shadowRoot.querySelector('[data-action="cancel-remove"]').textContent,
  }));
  expect(ui).toEqual({ panelOpacity: "0.72", frameOpacity: "0.35", panelCssOpacity: "1", view: "表示", option: "余白", dialogCancel: "キャンセル" });
  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem("codex-visual-instructions:preferences") ?? "{}"));
  expect(preferences.panel.opacity).toBe(0.72); expect(preferences.compare.opacity).toBe(0.35);
  await page.evaluate(async () => {
    (window as any).visualReview.destroy();
    const modulePath = "/dist/index.js";
    const { install } = await import(modulePath);
    (window as any).visualReview = install({ startActive: true });
  });
  const restored = await page.locator("[data-codex-visual-instructions]").evaluate((host: any) => ({
    panelOpacity: host.shadowRoot.querySelector("[data-panel-opacity]").value,
    compareOpacity: host.shadowRoot.querySelector("[data-compare-opacity]").value,
    compareMode: host.shadowRoot.querySelector("[data-compare]").value,
    viewOpen: host.shadowRoot.querySelector('[data-section="view"]').open,
    preferencesOpen: host.shadowRoot.querySelector('[data-section="preferences"]').open,
  }));
  expect(restored).toEqual({ panelOpacity: "72", compareOpacity: "35", compareMode: "overlay", viewOpen: true, preferencesOpen: true });
});

test("renders true side-by-side snapshots, syncs scroll, and cleans up", async ({ page }) => {
  await page.evaluate(async () => {
    (window as any).visualReview.destroy();
    const spacer = document.createElement("div"); spacer.id = "compare-spacer"; spacer.style.height = "4000px"; document.body.append(spacer);
    const modulePath = "/dist/index.js"; const { install } = await import(modulePath);
    (window as any).visualReview = install({ startActive: true });
  });
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => (window as any).visualReview.confirm());
  const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt);
  const beforeBodyStyle = await page.locator("body").getAttribute("style");
  const host = page.locator("[data-codex-visual-instructions]");
  await host.evaluate((element: any) => {
    const select = element.shadowRoot.querySelector("[data-compare]"); select.value = "side-by-side"; select.dispatchEvent(new Event("change"));
  });
  const surfaces = await host.evaluate((element: any) => {
    const root = element.shadowRoot; const wrapper = root.querySelector(".side-compare");
    return {
      hidden: wrapper.hidden,
      columns: [...root.querySelectorAll(".compare-surface")].map((surface: Element) => surface.getBoundingClientRect().width),
      labels: [...root.querySelectorAll(".side-label")].map((label: Element) => label.textContent),
      editedHasTitle: root.querySelector("[data-side-edited]").srcdoc.includes("A calmer way"),
      originalHasTitle: root.querySelector("[data-side-original]").srcdoc.includes("A calmer way"),
      originalOverlayHidden: root.querySelector(".compare").hidden,
    };
  });
  expect(surfaces.hidden).toBe(false);
  expect(surfaces.columns[0]!).toBeCloseTo(surfaces.columns[1]!, 0);
  expect(surfaces.labels).toEqual(["Edited — current preview", "Original — review snapshot"]);
  expect(surfaces.editedHasTitle).toBe(true); expect(surfaces.originalHasTitle).toBe(true); expect(surfaces.originalOverlayHidden).toBe(true);
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect.poll(() => host.evaluate((element: any) => {
    const root = element.shadowRoot;
    return Math.min(root.querySelector("[data-side-edited]").contentWindow.scrollY, root.querySelector("[data-side-original]").contentWindow.scrollY);
  })).toBeGreaterThan(0);
  const synced = await host.evaluate((element: any) => {
    const root = element.shadowRoot;
    return [root.querySelector("[data-side-edited]").contentWindow.scrollY, root.querySelector("[data-side-original]").contentWindow.scrollY];
  });
  expect(synced[0]).toBeGreaterThan(0); expect(synced[1]).toBeCloseTo(synced[0], 0);
  await host.evaluate((element: any) => {
    const select = element.shadowRoot.querySelector("[data-compare]"); select.value = "edited"; select.dispatchEvent(new Event("change"));
  });
  const cleanup = await host.evaluate((element: any) => ({
    sideHidden: element.shadowRoot.querySelector(".side-compare").hidden,
    editedSrcdoc: element.shadowRoot.querySelector("[data-side-edited]").hasAttribute("srcdoc"),
  }));
  expect(cleanup).toEqual({ sideHidden: true, editedSrcdoc: false });
  expect(await page.locator("body").getAttribute("style")).toBe(beforeBodyStyle);
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);
});

test("blocks side-by-side pointer events from reaching the live page", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).visualReview.start();
    (window as any).livePointerDowns = 0;
    document.querySelector("[data-testid=hero-title]")!.addEventListener("pointerdown", () => { (window as any).livePointerDowns += 1; });
  });
  const target = await page.getByTestId("hero-title").boundingBox(); expect(target).not.toBeNull();
  const host = page.locator("[data-codex-visual-instructions]");
  const annotationsBefore = await page.evaluate(() => (window as any).visualReview.session.annotations.length);
  await host.evaluate((element: any) => {
    const select = element.shadowRoot.querySelector("[data-compare]"); select.value = "side-by-side"; select.dispatchEvent(new Event("change"));
  });
  expect(await host.evaluate((element: any) => getComputedStyle(element.shadowRoot.querySelector(".side-compare")).pointerEvents)).toBe("auto");
  await page.mouse.click(target!.x + 10, target!.y + 10);
  expect(await page.evaluate(() => (window as any).livePointerDowns)).toBe(0);
  expect(await host.locator(".selection").count()).toBe(0);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(annotationsBefore);
});

test("keeps selection during side-by-side and resumes editing after leaving it", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  const selectedBefore = await host.locator("[data-meta]").textContent();
  const intro = await page.locator("#intro").boundingBox(); expect(intro).not.toBeNull();
  await host.evaluate((element: any) => {
    const select = element.shadowRoot.querySelector("[data-compare]"); select.value = "side-by-side"; select.dispatchEvent(new Event("change"));
  });
  await page.mouse.click(intro!.x + 10, intro!.y + 10);
  expect(await host.locator("[data-meta]").textContent()).toBe(selectedBefore);
  await host.evaluate((element: any) => {
    const select = element.shadowRoot.querySelector("[data-compare]"); select.value = "edited"; select.dispatchEvent(new Event("change"));
  });
  await page.locator("#intro").click({ position: { x: 10, y: 10 } });
  await expect(host.locator("[data-meta]")).toContainText("<p#intro>");
});

test("minimizes and resumes without changing a ready review", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => (window as any).visualReview.confirm());
  const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt);
  const previewTransform = await page.getByTestId("hero-title").getAttribute("style");
  await host.evaluate((element: any) => {
    const select = element.shadowRoot.querySelector("[data-compare]"); select.value = "side-by-side"; select.dispatchEvent(new Event("change"));
  });
  await page.evaluate(() => (window as any).visualReview.stop());
  expect(await page.evaluate(() => (window as any).visualReview.active)).toBe(false);
  await expect(host.locator(".panel")).toBeHidden();
  await expect(host.locator(".launcher")).toHaveText("Resume review");
  await expect(host.locator(".side-compare")).toBeVisible();
  expect(await host.locator(".selection").count()).toBe(0);
  expect(await page.getByTestId("hero-title").getAttribute("style")).toBe(previewTransform);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);
  await host.locator(".launcher").click();
  expect(await page.evaluate(() => (window as any).visualReview.active)).toBe(true);
  await expect(host.locator(".panel")).toBeVisible();
  await expect(host.locator(".side-compare")).toBeVisible();
  expect(await host.locator(".selection").count()).toBe(1);
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);
});

test("minimize cancels a temporary resize but keeps committed preview history", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const title = page.getByTestId("hero-title");
  await title.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  const committedTransform = await title.getAttribute("style");
  const target = page.locator("#intro");
  await target.click({ position: { x: 10, y: 10 } });
  const before = await target.boundingBox();
  const handle = await page.locator("[data-codex-visual-instructions] .resize").boundingBox();
  expect(before).not.toBeNull(); expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + 5, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 45, handle!.y + 30);
  await page.evaluate(() => (window as any).visualReview.stop());
  await page.mouse.up();
  expect(await target.getAttribute("style")).toBeNull();
  const after = await target.boundingBox();
  expect(after!.width).toBeCloseTo(before!.width, 0); expect(after!.height).toBeCloseTo(before!.height, 0);
  expect(await title.getAttribute("style")).toBe(committedTransform);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).visualReview.active)).toBe(false);
});

test("keeps draft work when end is cancelled and reuses confirm semantics", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]");
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  const transformBefore = await page.getByTestId("hero-title").getAttribute("style");
  await host.locator("[data-action=end-review]").click();
  await expect(host.locator("[data-end-dialog]")).toBeVisible();
  await expect(host.locator("[data-end-warning]")).toHaveText("Unconfirmed instructions: 1.");
  await expect(host.locator("[data-action=cancel-end]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(host.locator("[data-end-dialog]")).toBeHidden();
  await expect(host.locator("[data-action=end-review]")).toBeFocused();
  await host.locator("[data-action=end-review]").click();
  await host.locator("[data-action=cancel-end]").click();
  await expect(host.locator("[data-end-dialog]")).toBeHidden();
  expect(await page.getByTestId("hero-title").getAttribute("style")).toBe(transformBefore);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(1);
  expect(await host.locator("[data-action=undo]").isEnabled()).toBe(true);
  await host.locator("[data-action=end-review]").click();
  await host.locator("[data-action=confirm-end]").click();
  await expect(host.locator("[data-end-dialog]")).toBeHidden();
  expect(await page.evaluate(() => (window as any).visualReview.active)).toBe(true);
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBeTruthy();
  expect(await page.getByTestId("hero-title").getAttribute("style")).toBe(transformBefore);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(1);
  await host.locator("[data-action=end-review]").click();
  await expect(host.locator("[data-end-dialog]")).toBeHidden();
  expect(await page.evaluate(() => (window as any).visualReview.active)).toBe(false);
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(0);
});

test("discards review work, restores the page, and starts a fresh review", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]");
  const originalSessionId = await page.evaluate(() => (window as any).visualReview.session.sessionId);
  const originalTitle = await page.getByTestId("hero-title").textContent();
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  await host.evaluate((element: any) => {
    const root = element.shadowRoot;
    const text = root.querySelector("[data-text-input]"); text.value = "Temporary title"; root.querySelector('[data-action="text"]').click();
    const compare = root.querySelector("[data-compare]"); compare.value = "side-by-side"; compare.dispatchEvent(new Event("change"));
    const viewport = root.querySelector("[data-viewport]"); viewport.value = "mobile"; viewport.dispatchEvent(new Event("change"));
    const locale = root.querySelector("[data-locale]"); locale.value = "ja"; locale.dispatchEvent(new Event("change"));
    const theme = root.querySelector("[data-theme]"); theme.value = "light"; theme.dispatchEvent(new Event("change"));
  });
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(2);
  await host.locator("[data-action=end-review]").click();
  await expect(host.locator("[data-end-warning]")).toHaveText("未確定の指示が2件あります。");
  await host.locator("[data-action=discard-end]").click();
  expect(await page.evaluate(() => (window as any).visualReview.active)).toBe(false);
  await expect(host.locator(".panel")).toBeHidden();
  await expect(host.locator(".side-compare")).toBeHidden();
  await expect(host.locator(".compare")).toBeHidden();
  await expect(host.locator(".guide")).toBeHidden();
  expect(await host.locator(".selection").count()).toBe(0);
  await expect(page.getByTestId("hero-title")).toHaveText(originalTitle!);
  expect(await page.getByTestId("hero-title").getAttribute("style")).toBeNull();
  const ended = await page.evaluate(() => ({
    sessionId: (window as any).visualReview.session.sessionId,
    status: (window as any).visualReview.session.status,
    confirmedAt: (window as any).visualReview.session.confirmedAt,
    annotations: (window as any).visualReview.session.annotations.length,
    preferences: JSON.parse(localStorage.getItem("codex-visual-instructions:preferences") ?? "{}"),
  }));
  expect(ended.sessionId).not.toBe(originalSessionId);
  expect(ended.status).toBe("draft"); expect(ended.confirmedAt).toBeUndefined(); expect(ended.annotations).toBe(0);
  expect(ended.preferences.locale).toBe("ja"); expect(ended.preferences.appearance.theme).toBe("light");
  expect(ended.preferences.compare.mode).toBe("side-by-side"); expect(ended.preferences.review.defaultViewport).toBe("mobile");
  await expect(host.locator(".launcher")).toHaveText("レビュー開始");
  await host.locator(".launcher").click();
  expect(await host.locator("[data-action=undo]").isDisabled()).toBe(true);
  await expect(host.locator("[data-compare]")).toHaveValue("side-by-side");
  await expect(host.locator("[data-viewport]")).toHaveValue("mobile");
  await expect(host.locator(".side-compare")).toBeVisible();
  await expect(host.locator(".guide")).toBeVisible();
  await host.evaluate((element: any) => {
    const compare = element.shadowRoot.querySelector("[data-compare]"); compare.value = "edited"; compare.dispatchEvent(new Event("change"));
  });
  await page.locator("#intro").click({ position: { x: 10, y: 10 } });
  await expect(host.locator("[data-meta]")).toContainText("<p#intro>");
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(0);
});

test("opens localized help without changing a ready session", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } }); await page.keyboard.press("ArrowRight");
  await page.evaluate(() => (window as any).visualReview.confirm());
  const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt);
  const host = page.locator("[data-codex-visual-instructions]");
  await host.evaluate((element: any) => element.shadowRoot.querySelector('[data-action="help"]').click());
  expect(await host.evaluate((element: any) => element.shadowRoot.querySelector("[data-help-dialog]").open)).toBe(true);
  const english = await host.evaluate((element: any) => element.shadowRoot.querySelector("[data-help-dialog]").textContent);
  expect(english).toContain("Select an element"); expect(english).toContain("Alt + Shift + Arrow");
  expect(english).toContain("Side by side"); expect(english).toContain("visual specifications");
  await host.evaluate((element: any) => {
    const locale = element.shadowRoot.querySelector("[data-locale]"); locale.value = "ja"; locale.dispatchEvent(new Event("change"));
  });
  const japanese = await host.evaluate((element: any) => element.shadowRoot.querySelector("[data-help-dialog]").textContent);
  expect(japanese).toContain("基本の流れ"); expect(japanese).toContain("Visual Specification");
  await host.evaluate((element: any) => element.shadowRoot.querySelector('[data-action="close-help"]').click());
  expect(await host.evaluate((element: any) => element.shadowRoot.querySelector("[data-help-dialog]").open)).toBe(false);
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);
});

test("toggles localized field help by mouse click and keyboard activation", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  const host = page.locator("[data-codex-visual-instructions]");
  const helpButtons = host.locator(".field-help");
  expect(await helpButtons.count()).toBe(5);
  const textHelp = host.locator("[data-i18n=textHelp]");
  const textInput = host.locator("[data-text-input]");
  const inputBefore = await textInput.boundingBox();
  await helpButtons.nth(0).hover();
  await expect(textHelp).toBeHidden();
  await helpButtons.nth(0).click();
  await expect(textHelp).toBeVisible();
  await expect(textHelp).toContainText("single direct text node");
  const textHelpBox = await textHelp.boundingBox();
  const inputAfter = await textInput.boundingBox();
  const panelBox = await host.locator(".panel").boundingBox();
  expect(textHelpBox).not.toBeNull(); expect(inputBefore).not.toBeNull(); expect(inputAfter).not.toBeNull(); expect(panelBox).not.toBeNull();
  expect(inputAfter!.y).toBe(inputBefore!.y);
  expect(textHelpBox!.y + textHelpBox!.height).toBeLessThanOrEqual(inputAfter!.y);
  expect(textHelpBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(textHelpBox!.x + textHelpBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
  await helpButtons.nth(0).click();
  await page.waitForTimeout(200);
  await expect(textHelp).toBeHidden();
  const precisionHelp = host.locator("[data-i18n=precisionHelp]");
  await helpButtons.nth(3).focus();
  await helpButtons.nth(3).press("Enter");
  await expect(precisionHelp).toBeVisible();
  await expect(precisionHelp).toContainText("Relationship prioritizes");
  await host.evaluate((element: any) => {
    const locale = element.shadowRoot.querySelector("[data-locale]"); locale.value = "ja"; locale.dispatchEvent(new Event("change"));
  });
  await expect(precisionHelp).toContainText("関係性は要素同士の関係");
  await expect(helpButtons.nth(3)).toHaveAttribute("aria-label", "詳しい説明");
  expect(await page.evaluate(() => (window as any).visualReview.session.annotations.length)).toBe(0);
});

test("moves, persists, hides, and recovers the launcher with the shortcut", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } }); await page.keyboard.press("ArrowRight");
  await page.evaluate(() => { (window as any).visualReview.confirm(); (window as any).visualReview.stop(); });
  const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt);
  const launcher = page.locator("[data-codex-visual-instructions] .launcher");
  const before = await launcher.boundingBox(); expect(before).not.toBeNull();
  await page.mouse.move(before!.x + 15, before!.y + 15); await page.mouse.down(); await page.mouse.move(90, 120); await page.mouse.up();
  const moved = await launcher.boundingBox(); expect(moved!.x).toBeGreaterThanOrEqual(12); expect(moved!.y).toBeGreaterThanOrEqual(12);
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);
  await page.reload(); await page.locator("[data-codex-visual-instructions]").waitFor({ state: "attached" });
  const restored = await launcher.boundingBox(); expect(restored!.x).toBeCloseTo(moved!.x, 0); expect(restored!.y).toBeCloseTo(moved!.y, 0);
  await page.setViewportSize({ width: 360, height: 500 });
  await expect.poll(async () => { const box = await launcher.boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(348.5);
  await page.keyboard.press("Alt+Shift+R");
  const host = page.locator("[data-codex-visual-instructions]");
  await host.evaluate((element: any) => {
    const input = element.shadowRoot.querySelector("[data-launcher-visible]"); input.checked = false; input.dispatchEvent(new Event("change"));
    element.shadowRoot.querySelector('[data-action="toggle"]').click();
  });
  expect(await launcher.isVisible()).toBe(false);
  await page.keyboard.press("Alt+Shift+R");
  expect(await page.evaluate(() => (window as any).visualReview.active)).toBe(true);
  expect(await host.evaluate((element: any) => !element.shadowRoot.querySelector(".panel").hidden)).toBe(true);
});

test("persists theme and style without leaking appearance into the session", async ({ page }) => {
  await page.evaluate(() => (window as any).visualReview.start());
  await page.getByTestId("hero-title").click({ position: { x: 10, y: 10 } }); await page.keyboard.press("ArrowRight");
  await page.evaluate(() => (window as any).visualReview.confirm());
  const confirmedAt = await page.evaluate(() => (window as any).visualReview.session.confirmedAt);
  const host = page.locator("[data-codex-visual-instructions]");
  for (const value of ["system", "light", "dark", "high-contrast"]) await host.evaluate((element: any, theme) => {
    const select = element.shadowRoot.querySelector("[data-theme]"); select.value = theme; select.dispatchEvent(new Event("change"));
  }, value);
  await host.evaluate((element: any) => {
    const select = element.shadowRoot.querySelector("[data-style]"); select.value = "simple"; select.dispatchEvent(new Event("change"));
  });
  expect(await host.getAttribute("data-theme")).toBe("high-contrast"); expect(await host.getAttribute("data-style")).toBe("simple");
  expect(await page.evaluate(() => (window as any).visualReview.session.status)).toBe("ready");
  expect(await page.evaluate(() => (window as any).visualReview.session.confirmedAt)).toBe(confirmedAt);
  const serialized = await page.evaluate(() => JSON.parse((window as any).visualReview.serialize()));
  expect(serialized.appearance).toBeUndefined(); expect(serialized.launcher).toBeUndefined();
  await page.reload(); await page.locator("[data-codex-visual-instructions]").waitFor({ state: "attached" });
  expect(await host.getAttribute("data-theme")).toBe("high-contrast"); expect(await host.getAttribute("data-style")).toBe("simple");
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
