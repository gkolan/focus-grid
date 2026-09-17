import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.reload();
});

async function openMore(page: Page) {
  const details = page.locator("details", { has: page.locator("summary", { hasText: "More: start date" }) });
  if ((await details.getAttribute("open")) == null) await details.locator("summary").click();
}

async function gotoInbox(page: Page) {
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
}

test("recurring task: completing it leaves the next occurrence in the inbox", async ({ page }) => {
  await page.getByRole("button", { name: /^Add (a )?task$/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("Water plants");
  await page.getByRole("radio", { name: "A day", exact: true }).check();
  await page.locator('input[type="date"]').fill("2030-01-01");
  await openMore(page);
  await page.getByLabel("Repeat unit").selectOption("week");
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await gotoInbox(page);
  await page.getByRole("button", { name: /Water plants/ }).click();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByRole("button", { name: /Water plants/ })).toBeVisible(); // the next occurrence
  await expect(page.getByText(/Due .*Jan 8/)).toBeVisible();
  await page.getByRole("tab", { name: "Completed" }).click();
  await expect(page.getByText(/day streak/)).toBeVisible();
});

test("bulk add creates one task per line; #tag search and calendar view work", async ({ page }) => {
  await page.getByRole("button", { name: /^Add (a )?task$/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("Tagged one");
  await openMore(page);
  await page.getByLabel("Tags").fill("deep, home");
  await page.getByRole("radio", { name: "A day", exact: true }).check();
  await page.locator('input[type="date"]').fill("2030-03-15");
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await gotoInbox(page);
  await page.getByRole("button", { name: "Bulk add" }).click();
  await page.getByLabel("One task per line").fill("- Buy milk\n- Call mum\n");
  await page.getByRole("button", { name: "Add all" }).click();
  await expect(page.getByRole("button", { name: /Buy milk/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Call mum/ })).toBeVisible();
  await page.getByRole("button", { name: "#deep", exact: true }).click();
  await expect(page.getByRole("button", { name: /Tagged one/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Buy milk/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator(".period-label")).toHaveText(/\d{4}/);
  await expect(page.getByText(/2 undated task/)).toBeVisible();
});

test("subtask + delegation: delegated task is not the Focus pick; project shows subtask count", async ({ page }) => {
  await page.getByRole("button", { name: /^Add (a )?task$/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("Project X");
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await gotoInbox(page);
  await page.getByRole("button", { name: /Project X/ }).click();
  page.once("dialog", (d) => d.accept("Child step"));
  await page.getByRole("button", { name: "+ Subtask" }).click();
  await expect(page.getByText("Subtasks · 0/1 done")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: /Project X 0\/1 subtasks/ })).toBeVisible();

  await page.getByRole("button", { name: /Child step/ }).click();
  await openMore(page);
  await page.getByLabel("Delegated to").fill("Sam");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("→ Sam")).toBeVisible();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByText("Up next").first()).toBeVisible();
  await expect(page.locator("main").getByText("Project X").first()).toBeVisible();
});
