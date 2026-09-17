import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "@/test/unwrap";
import { complete, setAxisOverride } from "@/domain/commands";
import { calculatePriority } from "@/domain/priority";
import { openFocusGridDB } from "./db";
import { TaskRepository, type CommandContext } from "./repository";

const NOW = new Date("2026-09-10T12:00:00.000Z");
let seq = 0;
const ctx = (o: Partial<CommandContext> = {}): CommandContext => ({ operationId: `op-${++seq}`, now: NOW, ...o });

async function repo() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return new TaskRepository(o.db);
}

function inst(from: Date, mins: number) {
  return { kind: "instant" as const, at: new Date(from.getTime() + mins * 60_000).toISOString(), timeZone: "UTC" };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("background recalculation (42.1)", () => {
  it("RED-23: completed and archived tasks never drift", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "t1", title: "Done", deadline: inst(NOW, 1_440) }, ctx()));
    const done = unwrap(
      await r.mutate("t1", ctx({ expectedRevision: 1 }), (rec, _k, now) => complete(rec, now)),
    );
    const revAfterComplete = done.revision;

    const later = new Date(NOW.getTime() + 5 * 24 * 60 * 60_000);
    const out = await r.backgroundRecalc("t1", later);
    expect(out.changed).toBe(false);
    expect((await r.getTask("t1"))!.task.revision).toBe(revAfterComplete);
  });

  it("dated task drifts on recalc but an unchanged undated task is a no-op", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "dated", title: "Dated", deadline: inst(NOW, 2_000) }, ctx()));
    unwrap(await r.create({ id: "undated", title: "Undated" }, ctx()));

    const later = new Date(NOW.getTime() + 6 * 60 * 60_000);
    const d = await r.backgroundRecalc("dated", later);
    const u = await r.backgroundRecalc("undated", later);
    expect(d.changed).toBe(true);
    expect(u.changed).toBe(false);
    expect((await r.getTask("undated"))!.task.revision).toBe(1); // no revision bump for a no-op
  });

  it("RED-06/43: many small ticks store the cache quietly; cumulative drift eventually records history", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "t1", title: "Slow", deadline: inst(NOW, 2_880) }, ctx()));
    expect(await r.historyFor("t1")).toHaveLength(1); // creation snapshot only

    // one small 15-min tick moves less than the meaningful axis delta → no snapshot
    await r.backgroundRecalc("t1", new Date(NOW.getTime() + 15 * 60_000));
    expect(await r.historyFor("t1")).toHaveLength(1);

    // 24 further ticks over ~48h → the cache updates every time but history stays bounded
    for (let m = 120; m <= 48 * 60; m += 120) {
      await r.backgroundRecalc("t1", new Date(NOW.getTime() + m * 60_000));
    }
    const hist = await r.historyFor("t1");
    expect(hist.length).toBeGreaterThan(1); // cumulative drift crossed 0.05 at least once
    expect(hist.length).toBeLessThan(10); // NOT one row per tick
    expect(
      hist.slice(1).some((s) => s.reason.includes("time_pressure") || s.reason.includes("quadrant_changed")),
    ).toBe(true);
  });

  it("RED-44: a 30-day resume is one pass; stale task needs review, no history storm", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "old", title: "Old", deadline: inst(NOW, -60) }, ctx()));
    const before = (await r.historyFor("old")).length;

    const resumed = new Date(NOW.getTime() + 30 * 24 * 60 * 60_000);
    const pass = await r.recalcPass(resumed);
    expect(pass.recalculated).toBeLessThanOrEqual(1);

    const back = (await r.getTask("old"))!;
    // engine marks it needsReview (cutoff + 7d passed)
    expect(calculatePriority(back.task, resumed).needsReview).toBe(true);
    expect((await r.historyFor("old")).length - before).toBeLessThanOrEqual(2); // no per-tick replay
  });

  it("heartbeat recalc never changes lastUserEditedAt", async () => {
    const r = await repo();
    const c = unwrap(await r.create({ id: "t1", title: "T", deadline: inst(NOW, 3_000) }, ctx()));
    const edited = unwrap(
      await r.mutate("t1", ctx({ expectedRevision: c.revision }), (rec, _k, now) =>
        setAxisOverride(rec, "importance", 0.2, "editor", now),
      ),
    );
    const lue = edited.task.lastUserEditedAt;
    await r.backgroundRecalc("t1", new Date(NOW.getTime() + 10 * 60 * 60_000));
    expect((await r.getTask("t1"))!.task.lastUserEditedAt).toBe(lue);
  });

  it("RED-42: two recalcs of the same task at the same instant produce no duplicate snapshot", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "t1", title: "T", deadline: inst(NOW, 4_000) }, ctx()));
    const at = new Date(NOW.getTime() + 3 * 60 * 60_000);
    await r.backgroundRecalc("t1", at);
    const afterFirst = (await r.historyFor("t1")).length;
    await r.backgroundRecalc("t1", at); // same instant, same inputs
    expect((await r.historyFor("t1")).length).toBe(afterFirst);
  });
});
