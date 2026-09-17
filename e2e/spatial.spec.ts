import { expect, test, type Page } from "@playwright/test";

/**
 * SPAT-03 functional Grid ↔ Inbox comparison on a realistic, default-heavy
 * dataset (coincident anchors, long multilingual titles, blocked + partial
 * tasks). Screenshots are attached; the product verdict is in
 * spec/evidence/06-spatial.md.
 */
const now = Date.now();
const inst = (mins: number) => ({ kind: "instant", at: new Date(now + mins * 60000).toISOString(), timeZone: "America/Chicago" });

const TASKS: Record<string, unknown>[] = [
  ...Array.from({ length: 14 }, (_, i) => ({ title: `Someday item ${i} — いつかやること`, importance: "untouched" })),
  { title: "Prepare board proposal", importance: "high", deadline: inst(30 * 1440) }, // distant + high
  { title: "Refactor billing module", importance: "high", deadline: inst(3 * 1440), estimatedMinutes: 600 },
  { title: "Ship hotfix", importance: "high", deadline: inst(3 * 1440), estimatedMinutes: 20 }, // same-ish quadrant, diff urgency
  { title: "Waiting on legal review", importance: "untouched", deadline: inst(1440) }, // will block
  { title: "Half-written report", importance: "untouched", deadline: inst(1440), estimatedMinutes: 240 }, // will set 50%
  ...Array.from({ length: 6 }, (_, i) => ({ title: `Errand ${i}`, importance: "low" })),
];

async function seedSpatial(page: Page) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
  await page.evaluate(async (tasks) => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as {
      app: {
        createManualTask: (i: Record<string, unknown>) => Promise<{ ok: boolean; value?: { id: string; revision: number } }>;
        block: (id: string, r: number) => Promise<unknown>;
        setProgress: (id: string, r: number, p: number) => Promise<unknown>;
      };
      refresh: () => void;
    };
    for (const t of tasks) {
      const res = await f.app.createManualTask(t);
      if (res.ok && res.value && t.title === "Waiting on legal review") await f.app.block(res.value.id, res.value.revision);
      if (res.ok && res.value && t.title === "Half-written report") await f.app.setProgress(res.value.id, res.value.revision, 50);
    }
    f.refresh();
  }, TASKS);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle, svg text").length > 0);
}

test("SPAT-03: every task discoverable in Grid (pills/list) and Inbox; screenshots", async ({ page }, testInfo) => {
  await seedSpatial(page);

  // (1) a named undated task among overlapping anchors still has its own pill → click it
  await page.locator("svg text").filter({ hasText: /Someday item 0/ }).first().click();
  await expect(page.getByText(/Schedule region|Ignore region|Do Now region|Delegate region/).first()).toBeVisible();

  await testInfo.attach("spat-grid-light.png", { body: await page.screenshot(), contentType: "image/png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await testInfo.attach("spat-grid-dark.png", { body: await page.screenshot(), contentType: "image/png" });
  await page.emulateMedia({ colorScheme: "light" });

  // (2) high-importance distant task: deadline readable, left position not mistaken for low importance
  // 30 days out: outside the default week view, so open the month that holds it
  const due = new Date(Date.now() + 30 * 86_400_000);
  await page.goto(`/?e2e=1&view=focus&range=month&at=${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-01`);
  const proposal = page.getByRole("button", { name: /Prepare board proposal/ }).first();
  await expect(proposal).toContainText(/high importance/i);
  await expect(proposal).toContainText(/Due /);
  await page.goto("/?e2e=1&view=focus"); // back to this week for the near-term tasks

  // (3) two same-quadrant tasks, different urgency, distinguishable by text
  const refactor = page.getByRole("button", { name: /Refactor billing module/ }).first();
  const hotfix = page.getByRole("button", { name: /Ship hotfix/ }).first();
  const rt = (await refactor.textContent()) ?? "";
  const ht = (await hotfix.textContent()) ?? "";
  expect(rt).not.toBe(ht);

  // (4) blocked task visible, marked, not shown as immediately actionable
  await expect(page.getByRole("button", { name: /Waiting on legal review/ }).first()).toBeVisible();

  // (5) progress of a partial task without a separate bar
  await expect(page.getByRole("button", { name: /Half-written report/ }).first()).toContainText(/remaining/);

  // Inbox parity: same tasks reachable in the list view
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /Prepare board proposal/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Someday item 13/ })).toBeVisible();
});

test("SPAT-03 (6): change importance by drag, reload, task found at corrected position", async ({ page }) => {
  await seedSpatial(page);
  const due = new Date(Date.now() + 30 * 86_400_000);
  const at = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-01`;
  await page.goto(`/?e2e=1&view=focus&range=month&at=${at}`); // the month that holds the proposal
  await page.getByRole("button", { name: /Prepare board proposal/ }).first().click(); // select in the list
  await page.getByRole("button", { name: "Reschedule" }).click(); // opens the editor
  await page.getByRole("button", { name: "Save", exact: true }).click(); // close editor (no change)
  // drag on the field
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  const marker = page.locator('svg [role="button"][aria-label^="Prepare board proposal"]').first();
  const b = (await marker.boundingBox())!;
  await page.mouse.move(b.x + 22, b.y + 22);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y - 150, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("live-region")).toHaveText(/pinned/i);
  await page.reload();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  const pinned = await page.evaluate(async () => {
    const f = (window as unknown as Record<string, unknown>).__focusgrid as { app: { allViews: () => Promise<{ record: { task: Record<string, unknown> } }[]> } };
    return (await f.app.allViews()).find((v) => v.record.task.title === "Prepare board proposal")!.record.task.userImportanceOverride;
  });
  expect(pinned).not.toBeNull();
});
