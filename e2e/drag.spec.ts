import { expect, test, type Page } from "@playwright/test";

/**
 * Drag-and-drop on the field, end to end. Positions are read from the DOM, values from the store,
 * so every case checks both what the user saw and what was saved.
 */

type FG = {
  app: {
    createManualTask: (i: Record<string, unknown>) => Promise<{ ok: boolean; value: { id: string; revision: number } }>;
    allViews: () => Promise<{ record: { task: { id: string; title: string; urgency: number; importance: number; revision: number; userUrgencyOverride: unknown; userImportanceOverride: unknown } }; priority: { urgency: number; importance: number } }[]>;
    edit: (id: string, revision: number, patch: Record<string, unknown>) => Promise<unknown>;
    contexts: () => Promise<{ id: string; name: string }[]>;
  };
  refresh: () => void;
};

async function seed(page: Page, tasks: Record<string, unknown>[]) {
  await page.goto("/?e2e=1");
  await page.evaluate(() => indexedDB.deleteDatabase("focusgrid"));
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__focusgrid);
  await page.evaluate(async (ts) => {
    const f = (window as unknown as { __focusgrid: FG }).__focusgrid;
    for (const t of ts) await f.app.createManualTask(t);
    f.refresh();
  }, tasks);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0);
}

/** Stored placement of a task by title. */
async function stored(page: Page, title: string) {
  return page.evaluate(async (title) => {
    const f = (window as unknown as { __focusgrid: FG }).__focusgrid;
    const v = (await f.app.allViews()).find((x) => x.record.task.title === title)!;
    return { urgency: v.priority.urgency, importance: v.priority.importance, pinned: !!v.record.task.userUrgencyOverride, revision: v.record.task.revision };
  }, title);
}

const pill = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(`^${title}\\.`) }).first();
/** Screen position of the pill's dot (the marker) */
async function dot(page: Page, title: string) {
  const b = (await pill(page, title).boundingBox())!;
  return { x: b.x + 13, y: b.y + b.height / 2, box: b };
}
/** Field geometry: the svg box and the plot inset. */
async function field(page: Page) {
  const b = (await page.locator("main svg[role=group]").boundingBox())!;
  const INSET = 44;
  return { ...b, L: b.x + INSET, T: b.y + INSET, W: b.width - 2 * INSET, H: b.height - 2 * INSET, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
async function drag(page: Page, title: string, to: { x: number; y: number }, opts: { steps?: number; grab?: { dx: number; dy: number } } = {}) {
  const d = await dot(page, title);
  const gx = d.x + (opts.grab?.dx ?? 40), gy = d.y + (opts.grab?.dy ?? 0);
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 6, gy + 6); // clear the 4px threshold first
  await page.mouse.move(to.x + (gx - d.x), to.y + (gy - d.y), { steps: opts.steps ?? 12 });
  await page.mouse.up();
  await page.waitForTimeout(400); // save + settle animation
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test.describe("drag & drop", () => {
  test("basic: dropped where released; both axes pinned; value matches pixel", async ({ page }) => {
    await seed(page, [{ title: "Alpha", importance: "untouched" }]);
    const f = await field(page);
    const target = { x: f.L + f.W * 0.8, y: f.T + f.H * 0.25 }; // urgency +0.6, importance +0.5
    await drag(page, "Alpha", target);
    const s = await stored(page, "Alpha");
    expect(s.pinned).toBe(true);
    expect(near(s.urgency, 0.6, 0.03)).toBe(true);
    expect(near(s.importance, 0.5, 0.03)).toBe(true);
    const d = await dot(page, "Alpha");
    expect(near(d.x, target.x, 3)).toBe(true);
    expect(near(d.y, target.y, 3)).toBe(true);
  });

  test("grab anywhere on the pill: text or dot, same result", async ({ page }) => {
    await seed(page, [{ title: "Grab test", importance: "untouched" }]);
    const f = await field(page);
    await drag(page, "Grab test", { x: f.L + f.W * 0.3, y: f.T + f.H * 0.7 }, { grab: { dx: 0, dy: 0 } });
    const a = await stored(page, "Grab test");
    await drag(page, "Grab test", { x: f.L + f.W * 0.7, y: f.T + f.H * 0.3 }, { grab: { dx: 70, dy: 4 } });
    const b = await stored(page, "Grab test");
    expect(near(a.urgency, -0.4, 0.03) && near(a.importance, -0.4, 0.03)).toBe(true);
    expect(near(b.urgency, 0.4, 0.03) && near(b.importance, 0.4, 0.03)).toBe(true);
  });

  test("no jump on grab, even for a pill the layout had nudged", async ({ page }) => {
    // two tasks at the same point → second is nudged a row down
    await seed(page, [{ title: "Resident", importance: "untouched" }, { title: "Nudged", importance: "untouched" }]);
    const before = await dot(page, "Nudged");
    expect(near(before.y, (await dot(page, "Resident")).y, 1)).toBe(false); // it was nudged
    await page.mouse.move(before.x + 40, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x + 46, before.y); // just over the threshold
    await page.mouse.move(before.x + 47, before.y);
    await page.waitForTimeout(50);
    const during = await dot(page, "Nudged");
    expect(near(during.x, before.x + 7, 2)).toBe(true);
    expect(near(during.y, before.y, 2)).toBe(true); // no vertical snap
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("dropping onto another pill never moves the resident; both stay visible, no overlap", async ({ page }) => {
    await seed(page, [{ title: "Resident", importance: "high" }, { title: "Newcomer", importance: "low" }]);
    const r0 = await dot(page, "Resident");
    const s0 = await stored(page, "Resident");
    await drag(page, "Newcomer", { x: r0.x, y: r0.y });
    const r1 = await dot(page, "Resident");
    expect(near(r1.x, r0.x, 1) && near(r1.y, r0.y, 1)).toBe(true);
    expect(await stored(page, "Resident")).toEqual(s0);
    const a = r1.box, b = (await dot(page, "Newcomer")).box;
    const overlap = !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    expect(overlap).toBe(false);
    await expect(pill(page, "Newcomer")).toBeVisible();
  });

  test("past every edge clamps to ±1 and the pill stays on the page", async ({ page }) => {
    await seed(page, [{ title: "Edge", importance: "untouched" }]);
    const f = await field(page);
    for (const [to, want] of [
      [{ x: f.x + f.width + 300, y: f.cy - 60 }, { urgency: 1 }],
      [{ x: f.x - 300, y: f.cy - 60 }, { urgency: -1 }],
      [{ x: f.cx + 60, y: f.y - 300 }, { importance: 1 }],
      [{ x: f.cx + 60, y: f.y + f.height + 300 }, { importance: -1 }],
    ] as const) {
      await drag(page, "Edge", to);
      const s = await stored(page, "Edge");
      for (const [k, v] of Object.entries(want)) expect((s as unknown as Record<string, number>)[k]).toBeCloseTo(v, 5);
      const b = (await pill(page, "Edge").boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(f.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(f.x + f.width + 1);
      expect(b.y).toBeGreaterThanOrEqual(f.y - 1);
      expect(b.y + b.height).toBeLessThanOrEqual(f.y + f.height + 1);
    }
  });

  test("crossing an axis is continuous while dragging and lands where released", async ({ page }) => {
    await seed(page, [{ title: "Crosser", importance: "untouched" }]);
    const f = await field(page);
    await drag(page, "Crosser", { x: f.cx + 150, y: f.cy - 150 });
    const d = await dot(page, "Crosser");
    const gx = d.x + 40, gy = d.y;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + 6, gy);
    let prev = (await dot(page, "Crosser")).x;
    let maxStep = 0;
    for (let x = gx + 6; x > f.cx - 160; x -= 5) {
      await page.mouse.move(x, gy);
      const cur = (await dot(page, "Crosser")).x;
      maxStep = Math.max(maxStep, Math.abs(cur - prev));
      prev = cur;
    }
    expect(maxStep).toBeLessThanOrEqual(8);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const s = await stored(page, "Crosser");
    expect(s.urgency).toBeLessThan(0);
    const end = await dot(page, "Crosser");
    expect(near(end.x, f.cx - 160 - 40, 3)).toBe(true);
  });

  test("Escape mid-drag cancels: pill returns, nothing saved", async ({ page }) => {
    await seed(page, [{ title: "Cancel me", importance: "medium" }]);
    const before = await dot(page, "Cancel me");
    const s0 = await stored(page, "Cancel me");
    await page.mouse.move(before.x + 40, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x + 200, before.y + 100, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await dot(page, "Cancel me");
    expect(near(after.x, before.x, 1) && near(after.y, before.y, 1)).toBe(true);
    expect(await stored(page, "Cancel me")).toEqual(s0);
  });

  test("click (under threshold) selects and toggles the card; never pins", async ({ page }) => {
    await seed(page, [{ title: "Clicky", importance: "medium" }]);
    const d = await dot(page, "Clicky");
    await page.mouse.click(d.x + 40, d.y);
    await expect(page.getByRole("button", { name: "Edit task" })).toBeVisible();
    await page.mouse.click(d.x + 40, d.y);
    await expect(page.getByRole("button", { name: "Edit task" })).toHaveCount(0);
    expect((await stored(page, "Clicky")).pinned).toBe(false);
  });

  test("zoomed in: drop lands under the cursor and the value is exact", async ({ page }) => {
    await seed(page, [{ title: "Zoomed", importance: "untouched" }]);
    const f = await field(page);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100); // zoom around the pointer
    await page.mouse.move(f.cx, f.cy);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(30); }
    await page.waitForTimeout(100);
    const target = { x: f.cx + 120, y: f.cy - 90 };
    await drag(page, "Zoomed", target);
    const d = await dot(page, "Zoomed");
    expect(near(d.x, target.x, 3) && near(d.y, target.y, 3)).toBe(true);
    // value must be smaller than an unzoomed drag of the same pixel distance
    const s = await stored(page, "Zoomed");
    expect(s.urgency).toBeGreaterThan(0);
    expect(s.urgency).toBeLessThan(120 / (f.W / 2));
  });

  test("after panning the field, drags still land where released", async ({ page }) => {
    await seed(page, [{ title: "Panned", importance: "untouched" }]);
    const f = await field(page);
    await page.mouse.move(f.cx, f.cy);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(30); }
    await page.waitForTimeout(100);
    await page.mouse.move(f.cx + 200, f.cy + 200);
    await page.mouse.down();
    await page.mouse.move(f.cx, f.cy, { steps: 6 }); // pan on empty paper
    await page.mouse.up();
    const before = await stored(page, "Panned");
    expect(before.pinned).toBe(false); // panning never pins
    const target = { x: f.cx - 100, y: f.cy + 80 };
    await drag(page, "Panned", target);
    const d = await dot(page, "Panned");
    expect(near(d.x, target.x, 3) && near(d.y, target.y, 3)).toBe(true);
  });

  test("release outside the field still completes the drop (pointer capture)", async ({ page }) => {
    await seed(page, [{ title: "Outside", importance: "untouched" }]);
    const d = await dot(page, "Outside");
    await page.mouse.move(d.x + 40, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x + 46, d.y);
    await page.mouse.move(400, 10, { steps: 8 }); // up into the header
    await page.mouse.up();
    await page.waitForTimeout(400);
    const s = await stored(page, "Outside");
    expect(s.pinned).toBe(true);
    expect(s.importance).toBeCloseTo(1, 5);
  });

  test("two quick drags in a row both persist; reload keeps the last", async ({ page }) => {
    await seed(page, [{ title: "Quick", importance: "untouched" }]);
    const f = await field(page);
    await drag(page, "Quick", { x: f.L + f.W * 0.9, y: f.T + f.H * 0.1 }, { steps: 2 });
    await drag(page, "Quick", { x: f.L + f.W * 0.1, y: f.T + f.H * 0.9 }, { steps: 2 });
    const s = await stored(page, "Quick");
    expect(near(s.urgency, -0.8, 0.03) && near(s.importance, -0.8, 0.03)).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("svg circle").length > 0);
    expect(await stored(page, "Quick")).toEqual(s);
  });

  test("stale revision: task changed elsewhere mid-drag → drag refused, position untouched", async ({ page }) => {
    await seed(page, [{ title: "Conflict", importance: "untouched" }]);
    const d = await dot(page, "Conflict");
    await page.mouse.move(d.x + 40, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x + 200, d.y - 100, { steps: 4 });
    // another tab edits the task while we hold it
    await page.evaluate(async () => {
      const f = (window as unknown as { __focusgrid: FG }).__focusgrid;
      const v = (await f.app.allViews()).find((x) => x.record.task.title === "Conflict")!;
      await f.app.edit(v.record.task.id, v.record.task.revision, { title: "Conflict (edited)" });
    });
    await page.mouse.up();
    await expect(page.getByTestId("live-region")).toHaveText(/changed elsewhere/i);
    const s = await stored(page, "Conflict (edited)");
    expect(s.pinned).toBe(false);
  });

  test("touch: a finger drag moves the pill just like a mouse", async ({ page }) => {
    await seed(page, [{ title: "Touchy", importance: "untouched" }]);
    const f = await field(page);
    const d = await dot(page, "Touchy");
    const target = { x: f.L + f.W * 0.75, y: f.T + f.H * 0.3 };
    await page.evaluate(({ from, to }) => {
      const svg = document.querySelector("main svg[role=group]")!;
      const el = document.elementFromPoint(from.x, from.y)!;
      const ev = (type: string, x: number, y: number, target: Element) =>
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 }));
      ev("pointerdown", from.x, from.y, el);
      for (let i = 1; i <= 8; i++) ev("pointermove", from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8, svg);
      ev("pointerup", to.x, to.y, svg);
    }, { from: { x: d.x + 40, y: d.y }, to: { x: target.x + 40, y: target.y } });
    await page.waitForTimeout(400);
    const s = await stored(page, "Touchy");
    expect(s.pinned).toBe(true);
    expect(near(s.urgency, 0.5, 0.03) && near(s.importance, 0.4, 0.03)).toBe(true);
  });

  test("war: 12 tasks piled on one point — drag one out, the other 11 keep their places", async ({ page }) => {
    await seed(page, Array.from({ length: 12 }, (_, i) => ({ title: `Pile ${i}`, importance: "untouched" })));
    const f = await field(page);
    const before = new Map<string, { x: number; y: number }>();
    for (let i = 1; i < 12; i++) before.set(`Pile ${i}`, await dot(page, `Pile ${i}`));
    await drag(page, "Pile 0", { x: f.L + f.W * 0.85, y: f.T + f.H * 0.85 });
    for (const [t, p] of before) {
      const now = await dot(page, t);
      expect(near(now.x, p.x, 1) && near(now.y, p.y, 1), t).toBe(true);
    }
    const s = await stored(page, "Pile 0");
    expect(near(s.urgency, 0.7, 0.03) && near(s.importance, -0.7, 0.03)).toBe(true);
  });

  test("war: drag while the detail card is open — card follows the pill", async ({ page }) => {
    await seed(page, [{ title: "Carded", importance: "medium" }]);
    const f = await field(page);
    const d = await dot(page, "Carded");
    await page.mouse.click(d.x + 40, d.y);
    await expect(page.getByRole("button", { name: "Edit task" })).toBeVisible();
    await drag(page, "Carded", { x: f.L + f.W * 0.2, y: f.T + f.H * 0.8 });
    const p = (await pill(page, "Carded").boundingBox())!;
    const card = (await page.getByRole("button", { name: "Edit task" }).boundingBox())!;
    expect(Math.abs(card.x - p.x)).toBeLessThan(340); // anchored to the pill, not left behind
    expect(Math.abs(card.y - p.y)).toBeLessThan(400);
  });

  test("war: context filter hides a task; dragging a visible one never touches the hidden one", async ({ page }) => {
    await seed(page, [{ title: "Shown", importance: "untouched" }, { title: "Hidden", importance: "untouched" }]);
    await page.evaluate(async () => {
      const f = (window as unknown as { __focusgrid: FG }).__focusgrid;
      const cs = await f.app.contexts();
      const views = await f.app.allViews();
      for (const v of views) {
        const ctx = cs.find((c) => c.name === (v.record.task.title === "Shown" ? "Work" : "Home"))!;
        await f.app.edit(v.record.task.id, v.record.task.revision, { contextId: ctx.id });
      }
      f.refresh();
    });
    await page.getByLabel("Category").selectOption({ label: "Work" });
    await expect(pill(page, "Hidden")).toHaveCount(0);
    const f = await field(page);
    await drag(page, "Shown", { x: f.L + f.W * 0.9, y: f.T + f.H * 0.1 });
    expect((await stored(page, "Shown")).pinned).toBe(true);
    expect((await stored(page, "Hidden")).pinned).toBe(false);
  });

  test("war: pointer leaves the window and comes back — no stuck drag", async ({ page }) => {
    await seed(page, [{ title: "Lost", importance: "untouched" }]);
    const d = await dot(page, "Lost");
    await page.mouse.move(d.x + 40, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x + 100, d.y);
    // browser cancels the pointer (e.g. window blur / OS gesture)
    await page.evaluate(() => document.querySelector("main svg[role=group]")!.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })));
    await page.mouse.move(d.x + 300, d.y + 100);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect((await stored(page, "Lost")).pinned).toBe(false);
    const now = await dot(page, "Lost");
    expect(near(now.x, d.x, 1) && near(now.y, d.y, 1)).toBe(true);
  });
});
