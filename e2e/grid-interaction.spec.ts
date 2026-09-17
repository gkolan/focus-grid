import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, tasks: Record<string, unknown>[]) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
  await page.evaluate(async (ts) => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as {
      app: { createManualTask: (i: Record<string, unknown>) => Promise<unknown> };
      refresh: () => void;
    };
    for (const t of ts) await f.app.createManualTask(t);
    f.refresh();
  }, tasks);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0);
}

async function semanticSnapshot(page: Page) {
  return page.evaluate(async () => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as {
      app: { allViews: () => Promise<{ record: unknown }[]> };
    };
    return JSON.stringify((await f.app.allViews()).map((v) => v.record));
  });
}

test("RED-40/V-06-01: drag a marker pins both axes; persists across reload; click below threshold only selects", async ({ page }) => {
  await seed(page, [{ title: "Move me", importance: "untouched" }]);
  const target = page.getByRole("button", { name: /Move me/ }).first();
  const box = (await target.boundingBox())!;

  // tiny move (<4px) → selection only, no override
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2);
  await page.mouse.up();
  const ov = await page.evaluate(async () => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as { app: { allViews: () => Promise<{ record: { task: Record<string, unknown> } }[]> } };
    return (await f.app.allViews())[0].record.task.userUrgencyOverride;
  });
  expect(ov).toBeNull();

  // real drag → both overrides written
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 - 120, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("live-region")).toHaveText(/pinned/i);

  await page.reload();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  const snap = await page.evaluate(async () => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as { app: { allViews: () => Promise<{ record: { task: Record<string, unknown> } }[]> } };
    const t = (await f.app.allViews())[0].record.task;
    return { u: t.userUrgencyOverride, i: t.userImportanceOverride };
  });
  expect(snap.u).not.toBeNull();
  expect(snap.i).not.toBeNull();
});

test("RED-41: cancelling a drag with Escape writes nothing", async ({ page }) => {
  await seed(page, [{ title: "Do not move", importance: "untouched" }]);
  const before = await semanticSnapshot(page);
  const target = page.getByRole("button", { name: /Do not move/ }).first();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y - 100, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await semanticSnapshot(page)).toBe(before);
});

test("RED-13/31/108: pan and wheel-zoom never change semantic values", async ({ page }) => {
  await seed(page, Array.from({ length: 8 }, (_, i) => ({ title: `Task ${i}`, importance: "medium" })));
  const before = await semanticSnapshot(page);
  const svg = page.locator("svg[role=group]");
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60); // empty corner: the seeded pills sit mid-height
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 180, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, -400);
  await page.mouse.wheel(0, 300);
  expect(await semanticSnapshot(page)).toBe(before);
});

test("RED-96/97: coincident tasks all get their own pill, stacked without overlap", async ({ page }) => {
  // 20 identical default tasks → identical coordinates
  await seed(page, Array.from({ length: 20 }, (_, i) => ({ title: `Same ${i} — 同じ座標`, importance: "untouched" })));
  const pills = page.locator("svg text").filter({ hasText: /^Same \d+/ });
  await expect(pills).toHaveCount(20);
  const boxes = await pills.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
    }
});

test("RED-15: grid side panel is hidden by default, pinnable in settings", async ({ page }) => {
  await seed(page, [{ title: "Panel test", importance: "medium" }]);
  expect(await page.locator("aside").count()).toBe(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel(/Pin the task list beside the field/).check();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible();
});

test("WAR-06-01: resize mid-drag cancels; no override written", async ({ page }) => {
  await seed(page, [{ title: "Resize victim", importance: "untouched" }]);
  const before = await semanticSnapshot(page);
  const box = (await page.getByRole("button", { name: /Resize victim/ }).first().boundingBox())!;
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y - 90, { steps: 4 });
  await page.setViewportSize({ width: 900, height: 700 }); // resize mid-gesture
  await page.mouse.up();
  expect(await semanticSnapshot(page)).toBe(before);
});
