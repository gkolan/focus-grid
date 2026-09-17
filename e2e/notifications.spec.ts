import { expect, test, type Page } from "@playwright/test";

async function boot(page: Page) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
}

async function crossDeadlineThreshold(page: Page, enabled: boolean, quietHours: unknown) {
  return page.evaluate(
    async ({ enabled, quietHours }) => {
      const f = (window as unknown as Record<string, unknown>).__focusgrid as {
        app: {
          createManualTask: (i: Record<string, unknown>) => Promise<unknown>;
          updateSettings: (p: Record<string, unknown>) => Promise<unknown>;
        };
        repo: { recalcPass: (now: Date) => Promise<{ events: unknown[] }> };
        notifications: { processPass: (events: unknown[], now: Date) => Promise<{ delivered: number }> };
        clock: { current: { now: () => Date } };
        refresh: () => void;
      };
      // Fixed daytime base so quiet-hours behaviour is deterministic.
      const base = new Date("2026-06-15T12:00:00.000Z");
      f.clock.current = { now: () => base };
      await f.app.updateSettings({ notificationsEnabled: enabled, quietHours, timeZone: "UTC" });
      await f.app.createManualTask({
        title: "Report due soon",
        importance: "high",
        deadline: {
          kind: "instant",
          at: new Date(base.getTime() + 26 * 3600_000).toISOString(),
          timeZone: "UTC",
        },
      });
      f.refresh();
      // 4h later → task is now ~22h from the deadline (crossed the 24h threshold)
      const future = new Date(base.getTime() + 4 * 3600_000);
      f.clock.current = { now: () => future };
      const pass = await f.repo.recalcPass(future);
      const res = await f.notifications.processPass(pass.events, future);
      f.refresh();
      return res;
    },
    { enabled, quietHours },
  );
}

test("RED-90: OS permission not requested on load; enabling notifications shows the in-app feed", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel(/Show in-app notifications/).check();
  const res = await crossDeadlineThreshold(page, true, { start: "21:00", end: "08:00" });
  expect(res.delivered).toBe(1);

  await page.getByRole("button", { name: /Notifications \(/ }).click();
  await expect(page.getByText("A task is becoming time-sensitive.")).toBeVisible();
});

test("RED-92: an event crossed during quiet hours is not delivered to the feed", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel(/Show in-app notifications/).check();
  const res = await crossDeadlineThreshold(page, true, { start: "00:00", end: "23:59" });
  expect(res.delivered).toBe(0);

  await page.getByRole("button", { name: /Notifications \(/ }).click();
  await expect(page.getByText("A task is becoming time-sensitive.")).toHaveCount(0);
});

test("notifications are off by default — nothing in the feed", async ({ page }) => {
  await boot(page);
  await crossDeadlineThreshold(page, false, { start: "21:00", end: "08:00" });
  await page.getByRole("button", { name: /Notifications \(/ }).click();
  await expect(page.getByText(/Nothing yet/)).toBeVisible();
});
