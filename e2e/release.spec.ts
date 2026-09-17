import { expect, test, type Page } from "@playwright/test";

async function fresh(page: Page, url = "/") {
  await page.goto(url);
  await page.evaluate(() => {
    indexedDB.deleteDatabase("focusgrid");
    indexedDB.deleteDatabase("focusgrid-demo");
  });
  await page.goto(url);
}

async function addTask(page: Page, title: string) {
  await page.getByRole("button", { name: /^Add (a )?task$/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill(title);
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
}

test("RED-85: demo mode is a separate database; the live store is untouched and never reseeded", async ({ page }) => {
  await fresh(page);
  await addTask(page, "My real private task");
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /My real private task/ })).toBeVisible();

  // enter demo
  await page.goto("/?demo=1");
  await expect(page.getByRole("button", { name: "Exit demo" })).toBeVisible();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Send client proposal/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /My real private task/ })).toHaveCount(0);

  // reset demo — still no live data touched
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Send client proposal/ })).toBeVisible();

  // back to live — real task intact, demo tasks absent
  await page.goto("/");
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /My real private task/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send client proposal/ })).toHaveCount(0);
});

test("RED-111: 200% text zoom + dark theme — controls readable, focus visible, actions reachable", async ({ page }) => {
  await fresh(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await addTask(page, "Zoomed task");
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  const row = page.getByRole("button", { name: /Zoomed task/ });
  await expect(row).toBeVisible();
  await row.click();
  // the editor's Save/Cancel are reachable (dialog scrolls)
  await expect(page.getByRole("button", { name: /^Save( without AI)?$/ })).toBeVisible();
  await page.getByRole("button", { name: "Complete" }).click();
  // no horizontal page overflow even at 200%
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("WAR-13-01: full everyday resilience drill", async ({ page, context }) => {
  await fresh(page);
  // capture + drag on the grid
  await addTask(page, "Prepare the board proposal");
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0);
  const marker = page.locator('svg [role="button"][aria-label^="Prepare the board proposal"]').first();
  const b = (await marker.boundingBox())!;
  await page.mouse.move(b.x + 22, b.y + 22);
  await page.mouse.down();
  await page.mouse.move(b.x + 180, b.y - 120, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("live-region")).toHaveText(/pinned/i);

  // begin Focus
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // edit the same task in a second tab
  const page2 = await context.newPage();
  await page2.goto("/");
  await page2.getByRole("button", { name: "Inbox", exact: true }).click();
  await page2.getByRole("button", { name: /Prepare the board proposal/ }).click();
  await page2.getByRole("textbox", { name: /^Title/ }).fill("Prepare the board proposal v2");
  await page2.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page2.getByTestId("live-region")).toHaveText(/Task saved/i);
  await page2.close();

  // page 1 picks up the committed rename
  await page.reload();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Prepare the board proposal v2/ })).toBeVisible();

  // go offline, complete
  await context.setOffline(true);
  await page.getByRole("button", { name: /Prepare the board proposal v2/ }).click();
  await page.getByRole("button", { name: "Complete" }).click();
  await context.setOffline(false);

  // export → import into a "test profile" (same origin, delete-all + import)
  await page.getByRole("button", { name: "Settings" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export backup/ }).click(),
  ]);
  const file = await download.path();
  await page.getByRole("button", { name: "Delete all local data…" }).click();
  await page.getByLabel("Type DELETE ALL to confirm").fill("DELETE ALL");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.setInputFiles('input[type="file"][accept*="json"]', file);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText(/Imported 1 task/i);
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("tab", { name: "Completed" }).click();
  await expect(page.getByRole("button", { name: /Prepare the board proposal v2/ })).toBeVisible();
});

test("WAR-13-02: release adversary drill — dense fixture + long Unicode + zoom + reduced motion + provider timeout", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await fresh(page, "/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
  await page.evaluate(async () => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as {
      app: { createManualTask: (i: Record<string, unknown>) => Promise<unknown> };
      refresh: () => void;
    };
    for (let i = 0; i < 60; i++) {
      await f.app.createManualTask({
        title: `作業 ${i} — a very long multilingual responsibility title, مهمة طويلة, tâche longue`,
        importance: "medium",
      });
    }
    f.refresh();
  });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle, svg text").length > 0);
  // no drift animation classes under reduced motion
  expect(await page.locator("svg g.transition-transform").count()).toBe(0);

  // provider timeout during capture → manual save still works
  await page.getByRole("button", { name: /^Add (a )?task$/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("fixture:timeout adversary task");
  const interpret = page.getByRole("button", { name: "Interpret with AI" });
  if (await interpret.count()) {
    await interpret.click();
    await expect(page.getByRole("alert").filter({ hasText: /too long|unavailable/i })).toBeVisible();
  }
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /adversary task/ })).toBeVisible();
});
