import { expect, test, type Page } from "@playwright/test";


async function boot(page: Page) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
}

test("RED-30/44: resume advances the clock and performs ONE catch-up pass; no per-tick replay", async ({ page }) => {
  await boot(page);
  const id = await page.evaluate(async () => {
    const fg = (window as unknown as Record<string, unknown>).__focusgrid as unknown as {
      app: { createManualTask: (i: Record<string, unknown>) => Promise<{ ok: boolean; value: { id: string } }> };
      refresh: () => void;
    };
    const r = await fg.app.createManualTask({
      title: "Near deadline",
      importance: "untouched",
      deadline: { kind: "instant", at: new Date(Date.now() + 60 * 60_000).toISOString(), timeZone: "UTC" },
    });
    fg.refresh();
    return r.value.id;
  });

  const result = await page.evaluate(async ({ taskId }) => {
    const fg = (window as unknown as Record<string, unknown>).__focusgrid as unknown as {
      app: { allViews: () => Promise<{ record: { task: Record<string, unknown> } }[]>; history: (id: string) => Promise<{ snapshots: unknown[] }> };
      repo: { recalcPass: (now: Date) => Promise<{ recalculated: number }> };
      clock: { current: { now: () => Date } };
      refresh: () => void;
    };
    const before = (await fg.app.allViews())[0].record.task.urgency as number;
    const histBefore = (await fg.app.history(taskId)).snapshots.length;

    // "Resume" 3 days later — single pass.
    const future = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    fg.clock.current = { now: () => future };
    const pass = await fg.repo.recalcPass(future);
    fg.refresh();

    const after = (await fg.app.allViews())[0].record.task.urgency as number;
    const histAfter = (await fg.app.history(taskId)).snapshots.length;
    return { before, after, recalculated: pass.recalculated, histDelta: histAfter - histBefore };
  }, { taskId: id });

  expect(result.recalculated).toBe(1); // one task, one pass
  expect(result.after).toBeGreaterThan(result.before); // urgency rose toward/after the deadline
  expect(result.histDelta).toBeLessThanOrEqual(2); // no replay storm
});

test("stale overdue task surfaces Review actions after a catch-up pass", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const fg = (window as unknown as Record<string, unknown>).__focusgrid as unknown as {
      app: { createManualTask: (i: Record<string, unknown>) => Promise<unknown> };
      repo: { recalcPass: (now: Date) => Promise<unknown> };
      clock: { current: { now: () => Date } };
      refresh: () => void;
    };
    await fg.app.createManualTask({
      title: "Old low-value task",
      importance: "low",
      deadline: { kind: "instant", at: new Date(Date.now() - 60_000).toISOString(), timeZone: "UTC" },
    });
    const future = new Date(Date.now() + 20 * 24 * 60 * 60_000);
    fg.clock.current = { now: () => future };
    await fg.repo.recalcPass(future);
    fg.refresh();
  });

  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByRole("button", { name: "Still relevant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No longer needed" })).toBeVisible();
  await page.getByRole("button", { name: "Still relevant" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(/postponed/i);
  // after "still relevant" it leaves the Review list
  await expect(page.getByRole("button", { name: /Old low-value task/ })).toHaveCount(0);
});

test("RED-101: reduced motion disables marker transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  await page.evaluate(async () => {
    const fg = (window as unknown as Record<string, unknown>).__focusgrid as unknown as {
      app: { createManualTask: (i: Record<string, unknown>) => Promise<unknown> };
      repo: { recalcPass: (now: Date) => Promise<unknown> };
      clock: { current: { now: () => Date } };
      refresh: () => void;
    };
    await fg.app.createManualTask({
      title: "Moving task",
      importance: "untouched",
      deadline: { kind: "instant", at: new Date(Date.now() + 60 * 60_000).toISOString(), timeZone: "UTC" },
    });
    const future = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    fg.clock.current = { now: () => future };
    await fg.repo.recalcPass(future);
    fg.refresh();
  });
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0);
  const withTransition = await page.locator("svg g.transition-transform").count();
  expect(withTransition).toBe(0);
});
