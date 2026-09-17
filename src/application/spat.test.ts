import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { FocusGridApp } from "./service";
import { buildSpatFixture } from "@/test/spat-fixture";
import { layoutLabels, type LabelAnchor, project } from "@/grid";

const NOW = new Date("2026-09-09T14:00:00.000Z");

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function app() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return new FocusGridApp(new TaskRepository(o.db, undefined, {}), new FakeClock(NOW), o.db);
}

describe("SPAT-01 fixture", () => {
  it("creates exactly 100 active/blocked tasks through ordinary commands", async () => {
    const a = await app();
    const { created, blockedIds } = await buildSpatFixture(a, NOW);
    expect(created).toHaveLength(100);
    expect(blockedIds).toHaveLength(4);

    const all = await a.allViews();
    expect(all).toHaveLength(100);
    expect(all.every((v) => v.record.task.status === "active" || v.record.task.status === "blocked")).toBe(true);
    expect(all.filter((v) => v.record.task.status === "blocked")).toHaveLength(4);
    // context spread across all 8 (7 seeded + Uncategorized)
    const ctxNames = new Set(all.map((v) => v.contextName));
    expect(ctxNames.size).toBeGreaterThanOrEqual(8);
    // deliberately default-heavy → many coincident coordinates
    const coords = new Set(all.map((v) => `${v.priority.urgency.toFixed(4)},${v.priority.importance.toFixed(4)}`));
    expect(coords.size).toBeLessThan(all.length); // overlap exists, not engineered spread
  });

  it("RED-117: >250 handling not triggered at 100; grid shows all 100", async () => {
    const a = await app();
    await buildSpatFixture(a, NOW);
    const { shown, total } = await a.gridCandidates();
    expect(total).toBe(100);
    expect(shown).toHaveLength(100);
  });

  it("RED-122: label solver names every task in the default-heavy fixture", async () => {
    const a = await app();
    await buildSpatFixture(a, NOW);
    const views = (await a.gridCandidates()).shown;
    const plot = { L: 40, T: 40, W: 1360, H: 820 }; // 1440x900 minus inset
    const anchors: LabelAnchor[] = views.map((v) => {
      const p = project({ urgency: v.priority.urgency, importance: v.priority.importance }, plot, {
        zoom: 1,
        panX: 0,
        panY: 0,
      });
      return { id: v.record.task.id, x: p.x, y: p.y, title: v.record.task.title, selected: false };
    });
    const out = layoutLabels(anchors, plot, () => 0);
    // Every task gets a named pill, on the page.
    expect(out.labels).toHaveLength(100);
    for (const l of out.labels) {
      expect(l.x).toBeGreaterThanOrEqual(plot.L);
      expect(l.x + l.w).toBeLessThanOrEqual(plot.L + plot.W);
    }
  });

  it("V-06-02: a well-spaced 100-task layout reaches ≥80% visible labels", async () => {
    // Spread 100 tasks evenly across the field (the "standard seeded" spacing target).
    const plot = { L: 40, T: 40, W: 1360, H: 820 };
    const anchors: LabelAnchor[] = Array.from({ length: 100 }, (_, i) => {
      const c = i % 12;
      const r = Math.floor(i / 12);
      return {
        id: `g${i}`,
        x: plot.L + 40 + (c / 12) * (plot.W - 120),
        y: plot.T + 30 + (r / 9) * (plot.H - 90),
        title: `Responsibility ${i}`,
        selected: false,
      };
    });
    const out = layoutLabels(anchors, plot, () => 0);
    const pct = (out.labels.length / 100) * 100;
    console.log(`V-06-02 well-spaced 100-task labels visible: ${pct.toFixed(0)}%`);
    expect(pct).toBeGreaterThanOrEqual(80);
  });
});
