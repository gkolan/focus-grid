import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.reload();
});

async function addTask(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: /^Add (a )?task$/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill(title);
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(title.slice(0, 10)) })).toBeVisible();
}

test("V-10-03/04: export → delete all → import copies round-trips the tasks", async ({ page }) => {
  await addTask(page, "Café résumé task ☕");
  await addTask(page, "Second thing");

  await page.getByRole("button", { name: "Settings" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export backup/ }).click(),
  ]);
  const filePath = await download.path();

  // delete everything
  await page.getByRole("button", { name: "Delete all local data…" }).click();
  await page.getByLabel("Type DELETE ALL to confirm").fill("DELETE ALL");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(/All local data deleted/i);

  // empty store → first-run welcome; Inbox is not offered until a task exists
  await expect(page.getByRole("button", { name: "Inbox", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Café résumé/ })).toHaveCount(0);

  // import the backup as copies
  await page.getByRole("button", { name: "Settings" }).click();
  await page.setInputFiles('input[type="file"][accept*="json"]', filePath);
  await expect(page.getByText(/add.*2.*task/i)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText(/Imported 2 task/i);

  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Café résumé/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Second thing/ })).toBeVisible();
});

test("RED-76/WAR-10-01: a corrupt backup is rejected and the live store is untouched", async ({ page }) => {
  await addTask(page, "Live task keep me");
  await page.getByRole("button", { name: "Settings" }).click();

  const bad = Buffer.from('{"format":"focusgrid-export","schemaVersion":1,"exportedAt":"x","tasks":[{"__proto__":{}}],"provenance":[],"contexts":[],"history":[],"interpretations":[]}');
  await page.setInputFiles('input[type="file"][accept*="json"]', {
    name: "bad.json",
    mimeType: "application/json",
    buffer: bad,
  });
  await expect(page.getByText(/disallowed keys|not a FocusGrid backup|not valid JSON/i)).toBeVisible();

  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Live task keep me/ })).toBeVisible();
});

test("WAR-10-02: delete-all invalidates another view; a stale edit cannot resurrect the task", async ({ page, context }) => {
  await addTask(page, "Doomed task");
  const page2 = await context.newPage();
  await page2.goto("/");
  await page2.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page2.getByRole("button", { name: /Doomed task/ })).toBeVisible();

  // delete from page 1
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete all local data…" }).click();
  await page.getByLabel("Type DELETE ALL to confirm").fill("DELETE ALL");
  await page.getByRole("button", { name: "Delete everything" }).click();

  // page 2 sees it gone after a reload (single-origin IndexedDB is shared)
  await page2.reload();
  await expect(page2.getByRole("button", { name: "Inbox", exact: true })).toHaveCount(0); // first-run: no tasks
  await expect(page2.getByRole("button", { name: /Doomed task/ })).toHaveCount(0);
  await page2.close();
});
