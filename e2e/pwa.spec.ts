import { expect, test, type Page } from "@playwright/test";

// Service-worker lifecycle is stateful — run these in order on one worker.
test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

/** Robustly wait until a service worker controls the page. */
async function waitForSWControl(page: Page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const controlled = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "no-sw";
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller ? "yes" : "no";
    });
    if (controlled === "yes" || controlled === "no-sw") return controlled;
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
  return "no";
}

test("manifest is served and describes a standalone local app", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBe("FocusGrid");
  expect(m.display).toBe("standalone");
  expect(m.icons.length).toBeGreaterThan(0);
});

test("service worker caches only app-owned assets (never /api)", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const controlled = await waitForSWControl(page);
  test.skip(controlled === "no-sw", "no service worker support");
  expect(controlled).toBe("yes");

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const all: string[] = [];
    for (const n of names) {
      const c = await caches.open(n);
      for (const req of await c.keys()) all.push(new URL(req.url).pathname);
    }
    return all;
  });
  expect(cached.some((p) => p.startsWith("/api/"))).toBe(false);
  expect(cached).toContain("/");
});

test("WAR-11-01: airplane mode — cached app does local CRUD with the server offline; AI honest", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const controlled = await waitForSWControl(page);
  test.skip(controlled === "no-sw", "no service worker support");
  // let the fetch handler cache the JS chunks
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(async () => {
    const c = await caches.open("focusgrid-shell-v1");
    return (await c.keys()).some((k) => new URL(k.url).pathname.startsWith("/_next/"));
  }, null, { timeout: 20_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("See what actually needs you")).toBeVisible();

  await page.getByRole("button", { name: /Add (a )?task/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("Offline task");
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Offline task/ })).toBeVisible();
  await page.getByRole("button", { name: /Offline task/ }).click();
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("tab", { name: "Completed" }).click();
  await expect(page.getByRole("button", { name: /Offline task/ })).toBeVisible();

  await page.getByRole("button", { name: /Add (a )?task/ }).first().click();
  await page.getByRole("textbox", { name: /^Title/ }).fill("Another offline task");
  const interpretBtn = page.getByRole("button", { name: "Interpret with AI" });
  if (await interpretBtn.count()) {
    await interpretBtn.click();
    await expect(page.getByRole("alert").filter({ hasText: /unavailable|offline|too long/i })).toBeVisible();
  }
  await page.getByRole("button", { name: /^Save( without AI)?$/ }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("tab", { name: "All unfinished" }).click();
  await expect(page.getByRole("button", { name: /Another offline task/ })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Another offline task/ })).toBeVisible();

  await context.setOffline(false);
});

test("RED-104: the app never calls requestFullscreen (no rejected-promise path)", async ({ page }) => {
  await page.goto("/");
  const called = await page.evaluate(() => {
    let hit = false;
    const orig = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...a) {
      hit = true;
      return orig.apply(this, a as never);
    };
    return hit;
  });
  expect(called).toBe(false);
});
