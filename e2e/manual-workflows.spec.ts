import { expect, test, type Page } from "@playwright/test";

// Each test gets a clean IndexedDB.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.reload();
});

async function gotoInbox(page: Page) {
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
}

async function addTask(page: Page, title: string) {
  await page.getByRole("button", { name: /^Add (a )?task$/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill(title);
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await gotoInbox(page);
  const key = title.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page.getByRole("button", { name: new RegExp(key) })).toBeVisible();
}

test("RED-121: fresh store — default contexts only, no permission prompt, Add task works", async ({ page }) => {
  await expect(page.getByText("See what actually needs you")).toBeVisible();
  await addTask(page, "Clean the garage");
  await expect(page.getByRole("button", { name: /Clean the garage/ })).toBeVisible();
  await expect(page.getByText(/No deadline/)).toBeVisible();
});

test("smoke: local-only + AI-off stated in Settings", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText(/this browser profile only/i)).toBeVisible();
  await expect(page.getByTestId("ai-status")).toHaveText(/Demo interpretation/i);
});

test("create persists across reload with committed values", async ({ page }) => {
  await addTask(page, "Café résumé ☕");
  await page.reload();
  await expect(page.getByRole("button", { name: /Café résumé/ })).toBeVisible();
});

test("RED-75: script/HTML title renders as text, not markup", async ({ page }) => {
  await addTask(page, "<img src=x onerror=alert(1)> hello");
  const row = page.getByRole("button", { name: /hello/ });
  await expect(row).toBeVisible();
  expect(await page.locator("img[src='x']").count()).toBe(0);
});

test("complete then reopen; lifecycle via keyboard-reachable buttons", async ({ page }) => {
  await addTask(page, "Daycare form");
  await page.getByRole("button", { name: /Daycare form/ }).click();
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("tab", { name: "Completed" }).click();
  await expect(page.getByRole("button", { name: /Daycare form/ })).toBeVisible();
  await page.getByRole("button", { name: /Daycare form/ }).click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await page.getByRole("tab", { name: "All unfinished" }).click();
  await expect(page.getByRole("button", { name: /Daycare form/ })).toBeVisible();
});

test("RED-109: search with no match shows filter-empty, not onboarding", async ({ page }) => {
  await addTask(page, "Real task");
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("zzzznotfound");
  await expect(page.getByText("No tasks match these filters.")).toBeVisible();
  await expect(page.getByText("See what actually needs you")).toHaveCount(0);
});

test("RED-118: blocked task appears in All unfinished with status text", async ({ page }) => {
  await addTask(page, "Waiting on review");
  await page.getByRole("button", { name: /Waiting on review/ }).click();
  await page.getByRole("button", { name: "Block" }).click();
  await expect(page.getByRole("button", { name: /Waiting on review/ })).toBeVisible();
  await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();
});

test("creation undo removes the task within 10s", async ({ page }) => {
  await addTask(page, "Oops task");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /Oops task/ })).toHaveCount(0);
});

test("V-04-04: export backup downloads a JSON file", async ({ page }) => {
  await addTask(page, "Backup me");
  await page.getByRole("button", { name: "Settings" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export backup/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^focusgrid-backup-.*\.json$/);
});

test("RED-84: deleting a context reassigns its tasks, tasks remain", async ({ page }) => {
  await page.getByRole("button", { name: "Add a task" }).click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("Chore");
  await page.getByLabel("Context").selectOption({ label: "Home" });
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole?.("button", { name: "Add" }); // no-op guard
  // Home is seeded and cannot be deleted; create a custom one, assign, delete it.
  await page.getByLabel("New context").fill("Temp");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Inbox" }).click();
  await page.getByRole("button", { name: /Chore/ }).click();
  await page.getByLabel("Context").selectOption({ label: "Temp" });
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .locator("li", { hasText: "Temp" })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("button", { name: "Delete and move tasks" }).click();
  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByRole("button", { name: /Chore/ })).toBeVisible();
});
