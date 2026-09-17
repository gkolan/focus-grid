import { expect, test, type Page } from "@playwright/test";

/** Deep links: view, task and focus-grid live in the URL, survive reload, and respect back/forward. */
async function seed(page: Page, tasks: Record<string, unknown>[]) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
  return page.evaluate(async (ts) => {
    const f = (window as unknown as { __focusgrid: { app: { createManualTask: (i: Record<string, unknown>) => Promise<{ value: { id: string } }> }; refresh: () => void } }).__focusgrid;
    const ids: string[] = [];
    for (const t of ts) ids.push((await f.app.createManualTask(t)).value.id);
    f.refresh();
    return ids;
  }, tasks);
}

test("selecting a task on the grid or in Focus puts it in the URL; the editor keeps it; reload restores it", async ({ page }) => {
  const [id] = await seed(page, [{ title: "Linked task", importance: "medium" }]);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.getByRole("button", { name: /^Linked task\./ }).first().click(); // pill → card
  await expect(page).toHaveURL(new RegExp(`task=${id}`));
  await expect(page.getByRole("button", { name: "Edit task" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit task" })).toBeVisible(); // card re-opens from the URL
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page).toHaveURL(/view=focus/);
  await expect(page).toHaveURL(new RegExp(`task=${id}`)); // selection survives the view change
  await expect(page.getByRole("button", { name: /Linked task/ }).first()).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Reschedule" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`task=${id}`)); // closing the editor keeps the selection
});

test("a direct ?view=grid&task=<id> link lands on that task; unknown ids are reported", async ({ page }) => {
  const [id] = await seed(page, [{ title: "Bookmarked", importance: "high" }]);
  await page.goto(`/?e2e=1&view=grid&task=${id}`);
  await expect(page.getByRole("button", { name: "Edit task" })).toBeVisible(); // the card, on the grid
  await page.getByRole("button", { name: "Edit task" }).click();
  await expect(page.getByRole("textbox", { name: /^Title/ })).toHaveValue("Bookmarked");
  await page.goto(`/?e2e=1&view=grid&task=00000000-0000-0000-0000-000000000000`);
  await expect(page.getByTestId("live-region")).toHaveText(/doesn't have/);
  await expect(page).not.toHaveURL(/task=/);
});

test("browser back returns to the previous view", async ({ page }) => {
  await seed(page, [{ title: "Nav", importance: "medium" }]);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page).toHaveURL(/view=inbox/);
  await page.goBack();
  await expect(page).toHaveURL(/view=focus/);
  await expect(page.getByRole("heading", { name: /^Tasks · / })).toBeVisible();
});

test("the focus-grid picker is in the URL", async ({ page }) => {
  await seed(page, [{ title: "Ctx", importance: "medium" }]);
  await page.getByLabel("Category").selectOption({ label: "Work" });
  await expect(page).toHaveURL(/category=/);
  const url = page.url();
  await page.goto(url);
  await expect(page.getByLabel("Category")).toHaveValue(/.+/);
  await expect(page.getByLabel("Category").locator("option:checked")).toHaveText("Work");
});
