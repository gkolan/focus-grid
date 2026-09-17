import { expect, test, type Page } from "@playwright/test";

const TITLES = [
  "Prepare quarterly proposal", "Review pull request", "Book dentist", "Fix release blocker",
  "Plan birthday party", "Renew car insurance", "Draft newsletter", "Call plumber",
  "Study for exam", "Submit expense report", "Water the plants", "Read design doc",
  "Update résumé ☕", "Schedule 1:1s", "Backup photos", "Clean garage",
  "Pay utility bill", "Prep interview questions", "Order groceries", "Write retro notes",
];

async function seed(page: Page) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
  await page.evaluate(async (titles) => {
    const fg = (window as unknown as Record<string, unknown>).__focusgrid as {
      app: {
        createManualTask: (i: Record<string, unknown>) => Promise<{ ok: boolean }>;
        edit: (id: string, rev: number, patch: unknown) => Promise<unknown>;
      };
      refresh: () => void;
    };
    for (let i = 0; i < titles.length; i++) {
      await fg.app.createManualTask({
        title: titles[i],
        importance: i % 3 === 0 ? "high" : i % 3 === 1 ? "low" : "medium",
        deadline:
          i % 2 === 0
            ? { kind: "instant", at: new Date(Date.now() + (i - 5) * 3600_000).toISOString(), timeZone: "UTC" }
            : null,
        estimatedMinutes: i % 4 === 0 ? 120 : null,
      });
    }
    fg.refresh();
  }, TITLES);
  await page.getByRole("button", { name: "Grid" }).click();
}

test("RED-07/08: continuous field of compact markers, not four lists or cards", async ({ page }) => {
  await seed(page);
  const circles = page.locator("svg circle");
  await expect(circles.first()).toBeVisible();
  // 20 tasks => at least 20 marker glyphs; positions are varied (continuous), not 4 columns.
  const xs = await page.locator('svg g[role="button"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute("transform")?.match(/translate\(([-\d.]+)/)?.[1]).filter(Boolean),
  );
  expect(new Set(xs).size).toBeGreaterThan(6);
  // No big task cards rendered by default.
  expect(await page.locator("svg foreignObject").count()).toBe(0);
});

test("RED-13/114: resize and theme change do not mutate semantic values", async ({ page }) => {
  await seed(page);
  const before = await page.evaluate(async () => {
    const fg = (window as unknown as Record<string, unknown>).__focusgrid as { app: { allViews: () => Promise<{ record: unknown }[]> } };
    return JSON.stringify((await fg.app.allViews()).map((v) => v.record));
  });
  await page.setViewportSize({ width: 700, height: 900 });
  await page.setViewportSize({ width: 1500, height: 780 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  const after = await page.evaluate(async () => {
    const fg = (window as unknown as Record<string, unknown>).__focusgrid as { app: { allViews: () => Promise<{ record: unknown }[]> } };
    return JSON.stringify((await fg.app.allViews()).map((v) => v.record));
  });
  expect(after).toBe(before);
});

test("WAR-05-02: keyboard-only — select a task from the list and open it", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  const row = page.getByRole("button", { name: /Study for exam/ }).first();
  await row.scrollIntoViewIfNeeded();
  await row.focus();
  await page.keyboard.press("Enter"); // selects it in the Focus pane
  await expect(page.getByRole("heading", { name: /Study for exam/ }).or(page.getByText("Study for exam").nth(1))).toBeVisible();
  await page.getByRole("button", { name: "Reschedule" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit task" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("V-05-04: details show remaining-effort strings and Delegate tooltip exists", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByText(/Estimate unknown/).first()).toBeVisible();
  await expect(page.getByText(/min remaining|h remaining/).first()).toBeVisible();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0, null, { timeout: 10000 });
  expect(await page.getByRole("group", { name: /^Task field/ }).innerHTML()).toContain("assignment and messaging are not included");
});


test("V-05-03: light and dark field screenshots", async ({ page }, testInfo) => {
  await seed(page);
  await page.emulateMedia({ colorScheme: "light" });
  await testInfo.attach("grid-light.png", { body: await page.screenshot(), contentType: "image/png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await testInfo.attach("grid-dark.png", { body: await page.screenshot(), contentType: "image/png" });
});
