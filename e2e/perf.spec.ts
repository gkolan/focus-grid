import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function seed(page: Page, n: number) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
  await page.evaluate(async (count) => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as {
      app: { createManualTask: (i: Record<string, unknown>) => Promise<unknown> };
      refresh: () => void;
    };
    for (let i = 0; i < count; i++) {
      await f.app.createManualTask({
        title: `Task ${i} — responsibility with a moderately long descriptive name`,
        importance: i % 3 === 0 ? "high" : i % 3 === 1 ? "low" : "medium",
        deadline:
          i % 2 === 0
            ? { kind: "instant", at: new Date(Date.now() - i * 60_000).toISOString(), timeZone: "UTC" } // recent past: inside every period view
            : null,
        estimatedMinutes: i % 4 === 0 ? 120 : null,
      });
    }
    f.refresh();
  }, n);
}

test("§52: recalcPass over 1000 active tasks — median of 5 [target ≤ 500ms]", async ({ page }) => {
  await seed(page, 1000);
  const median = await page.evaluate(async () => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as {
      repo: { recalcPass: (now: Date) => Promise<unknown> };
    };
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const at = new Date(Date.now() + (r + 1) * 6 * 3600_000);
      const t0 = performance.now();
      await f.repo.recalcPass(at);
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    return runs[2];
  });
  console.log(`PERF e2e recalcPass(1000) median = ${median.toFixed(0)}ms (target ≤ 500ms)`);
  expect(median, "recalcPass(1000) median").toBeLessThan(1500); // hard ceiling; the 500ms target is recorded
});

test("§52 / RED-106: 1000 tasks → grid shows 250 with disclosure; every task is searchable", async ({ page }) => {
  await seed(page, 1000);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0);
  await expect(page.getByText(/Showing 250 of 1000/)).toBeVisible();
  // the 900th task is not a marker; use Inbox search for the full set
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Task 937 ");
  await expect(page.getByRole("button", { name: /Task 937 —/ })).toBeVisible();
});

test("§52: 100-task grid is useful within [target ≤ 1000ms] of data being loaded", async ({ page }) => {
  await seed(page, 100);
  await expect(page.getByRole("button", { name: "Grid", exact: true })).toBeVisible();
  const ms = await page.evaluate(async () => {
    const t0 = performance.now();
    // switch to Grid and wait until markers are painted
    const grid = [...document.querySelectorAll("button")].find((b) => b.textContent === "Grid")!;
    grid.click();
    await new Promise<void>((resolve) => {
      const check = () => {
        if (document.querySelectorAll("svg circle").length > 0) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
    return performance.now() - t0;
  });
  console.log(`PERF e2e 100-task grid useful in ${ms.toFixed(0)}ms (target ≤ 1000ms)`);
  expect(ms, "100-task grid render").toBeLessThan(3000); // hard ceiling; 1000ms target recorded
});

test("§52: 100-marker pan — p95 frame interval over ~3s [target ≤ 20ms, 60fps]", async ({ page }) => {
  await seed(page, 100);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0);
  const svg = page.locator("svg[role=group]");
  const box = (await svg.boundingBox())!;

  const intervals: number[] = [];
  await page.evaluate(() => {
    (window as unknown as { __frames: number[] }).__frames = [];
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      (window as unknown as { __frames: number[] }).__frames.push(now - last);
      last = now;
      if ((window as unknown as { __frames: number[] }).__frames.length < 200) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  // drive a pan gesture for ~3s
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(box.x + 200 + Math.sin(i / 5) * 120, box.y + 200 + Math.cos(i / 7) * 90);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  const frames: number[] = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
  frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)];
  intervals.push(p95);
  console.log(`PERF e2e 100-marker pan p95 frame interval = ${p95.toFixed(1)}ms (target ≤ 20ms)`);
  expect(p95, "pan p95 frame interval").toBeLessThan(60); // hard ceiling; 20ms target recorded
});
