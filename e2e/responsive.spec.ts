import { expect, test } from "@playwright/test";

const SIZES = [
  { w: 320, h: 568 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1024, h: 768 },
  { w: 1280, h: 720 },
  { w: 1440, h: 900 },
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
});

async function seedOne(page: import("@playwright/test").Page) {
  await page.reload();
  await page.getByRole("button", { name: /Add (a )?task/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("Seed task");
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
}

test("RED-16: < 768 opens Focus; >= 768 opens Grid", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  await expect(page.getByRole("button", { name: /Menu — showing Focus/ })).toBeVisible();

  await page.goto("/");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(page.locator("main.view-grid")).toBeVisible();
});

test("RED-102/no horizontal overflow at every target width", async ({ page }) => {
  for (const { w, h } of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    // add a task with a long title so content is non-trivial
    await page.getByRole("button", { name: /Add (a )?task/ }).first().click();
    await page.getByRole("textbox", { name: /^Title/ }).fill("A fairly long task title that should not cause the page to scroll sideways");
    await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `width ${w}`).toBeLessThanOrEqual(1);
  }
});

test("RED-103: sidebar pin is a desktop preference; phone width shows overlay nav only", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedOne(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel(/Pin the task list beside the field/).check();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible();

  // shrink to phone — no pinned aside, overlay menu instead
  await page.setViewportSize({ width: 380, height: 800 });
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Menu —/ })).toBeVisible();

  // back to desktop — preference retained
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("aside")).toBeVisible();
});

test("resize does not reset the current route", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedOne(page); // Inbox only exists once a task does
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.getByRole("button", { name: /Menu — showing Inbox/ })).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.getByRole("button", { name: "Inbox", exact: true })).toHaveAttribute("aria-current", "page");
});

test("overlay navigation on tablet width (768–1023)", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1024 });
  await seedOne(page);
  await page.getByRole("button", { name: /^Menu —/ }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Focus" }).click();
  await expect(page.getByRole("heading", { name: /^Tasks · / })).toBeVisible();
});
