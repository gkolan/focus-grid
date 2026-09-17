import { expect, test } from "@playwright/test";

test("shell loads with no credential; first-run onboarding visible", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.reload();
  await expect(page.getByText("See what actually needs you")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText(/this browser profile only/i)).toBeVisible();
  await expect(page.getByTestId("ai-status")).toHaveText(/Demo interpretation/i);
});
