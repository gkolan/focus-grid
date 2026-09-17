import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { FocusGridApp } from "./service";
import { __resetFocusSession } from "./focus-session";
import { buildSpatFixture } from "@/test/spat-fixture";

const NOW = "2026-09-10T12:00:00.000Z";

async function makeApp() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return new FocusGridApp(new TaskRepository(o.db, undefined, {}), new FakeClock(NOW), o.db);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  __resetFocusSession();
});

describe("FocusGridApp Focus (section 44)", () => {
  it("recommends the top eligible task; blocked/deferred excluded but still visible on the grid", async () => {
    const app = await makeApp();
    await app.createManualTask({ title: "Top", importance: "high" });
    const blk = await app.createManualTask({ title: "Blocked one", importance: "high" });
    if (blk.ok) await app.block(blk.value.id, blk.value.revision);
    await app.createManualTask({
      title: "Later",
      importance: "high",
      startAt: new Date(Date.parse(NOW) + 3_600_000).toISOString(),
    });

    const f = await app.focus();
    expect(f.current?.record.task.title).toBe("Top");

    // grid still shows the blocked + deferred ones
    const grid = await app.gridCandidates();
    expect(grid.shown.map((v) => v.record.task.title).sort()).toEqual(["Blocked one", "Later", "Top"]);
  });

  it("WAR-08-01: Start pins the task; a new higher-ranked task does not swap it; block clears it once", async () => {
    const app = await makeApp();
    const started = await app.createManualTask({ title: "Started", importance: "medium" });
    if (!started.ok) throw new Error();
    app.focusStart(started.value.id);
    expect((await app.focus()).current?.record.task.title).toBe("Started");

    await app.createManualTask({ title: "Newer bigger", importance: "high" });
    const f = await app.focus();
    expect(f.current?.record.task.title).toBe("Started"); // no involuntary swap
    expect(f.recommendationChanged).toBe(true);

    const cur = f.current!.record.task;
    const b = await app.focusBlock(cur.id, cur.revision);
    expect(b.ok).toBe(true);
    const after = await app.focus();
    expect(after.current?.record.task.title).toBe("Newer bigger"); // pin cleared, next offered
  });

  it("RED-60: skipping every eligible task yields all_skipped and reset restores them", async () => {
    const app = await makeApp();
    for (const t of ["A", "B", "C"]) await app.createManualTask({ title: t, importance: "medium" });
    for (let i = 0; i < 3; i++) {
      const f = await app.focus();
      if (f.current) app.focusSkip(f.current.record.task.id);
    }
    const empty = await app.focus();
    expect(empty.current).toBeNull();
    expect(empty.emptyReason).toBe("all_skipped");

    app.focusResetSkipped();
    expect((await app.focus()).current).not.toBeNull();
  });

  it("RED-64: completing the focused task in 'another tab' clears focus after refresh", async () => {
    const app = await makeApp();
    const t = await app.createManualTask({ title: "Focus me", importance: "high" });
    if (!t.ok) throw new Error();
    app.focusStart(t.value.id);

    // simulate another tab: complete via the plain command
    await app.complete(t.value.id, t.value.revision);

    const f = await app.focus();
    expect(f.current?.record.task.id).not.toBe(t.value.id);
  });

  it("WAR-08-02: only blocked/deferred/stale tasks → honest empty reason, no false recommendation", async () => {
    const app = await makeApp();
    const b = await app.createManualTask({ title: "Blocked", importance: "high" });
    if (b.ok) await app.block(b.value.id, b.value.revision);
    await app.createManualTask({
      title: "Deferred",
      importance: "high",
      startAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
    });
    const f = await app.focus();
    expect(f.current).toBeNull();
    expect(f.emptyReason).toBe("no_actionable");
  });

  it("SPAT-06: on the default-heavy 100-task fixture Focus recommends one actionable task, never a blocked/deferred/review one", async () => {
    const app = await makeApp();
    await buildSpatFixture(app, new Date(NOW));
    const f = await app.focus();
    expect(f.current).not.toBeNull();
    const t = f.current!.record.task;
    expect(t.status).toBe("active");
    expect(f.current!.priority.needsReview).toBe(false);
    expect(t.startAt == null || Date.parse(t.startAt) <= Date.parse(NOW)).toBe(true);
    expect(f.current!.rationale.length).toBeGreaterThan(2);
    // grid still exposes everything (blocked etc.)
    expect((await app.gridCandidates()).total).toBe(100);
  });

  it("Focus context filter is independent of anything grid-side", async () => {
    const app = await makeApp();
    const contexts = await app.contexts();
    const work = contexts.find((c) => c.name === "Work")!;
    const family = contexts.find((c) => c.name === "Family")!;
    await app.createManualTask({ title: "Work task", importance: "high", contextId: work.id });
    await app.createManualTask({ title: "Family task", importance: "medium", contextId: family.id });

    app.focusSetContextFilter([family.id]);
    expect((await app.focus()).current?.record.task.title).toBe("Family task");
    app.focusSetContextFilter(null);
    expect((await app.focus()).current?.record.task.title).toBe("Work task");
  });
});

describe("Focus work log", () => {
  it("start/pause is one session; notes are standalone entries; complete is logged", async () => {
    const app = await makeApp();
    const clock = (app as unknown as { clock: FakeClock }).clock;
    const t = await app.createManualTask({ title: "Logged", importance: "medium" });
    if (!t.ok) throw new Error();
    const task = async () => (await app.allViews()).find((v) => v.record.task.id === t.value.id)!.record.task;

    await app.focusStart(t.value.id);
    expect((await task()).worklog).toEqual([{ kind: "session", start: NOW, end: null }]);
    clock.advanceMinutes(5);
    await app.focusPause();
    let cur = await task();
    expect(cur.worklog).toEqual([{ kind: "session", start: NOW, end: "2026-09-10T12:05:00.000Z" }]);
    expect(cur.timeSpentMinutes).toBe(5);

    expect((await app.addWorkNote(cur.id, cur.revision, "   ")).ok).toBe(false);
    expect((await app.addWorkNote(cur.id, cur.revision, "  waiting on finance ")).ok).toBe(true);
    cur = await task();
    expect(cur.worklog?.[1]).toEqual({ kind: "note", at: "2026-09-10T12:05:00.000Z", note: "waiting on finance" });
    expect((await app.editWorkNote(cur.id, cur.revision, 0, "x")).ok).toBe(false); // not a note
    expect((await app.editWorkNote(cur.id, cur.revision, 1, "got the numbers")).ok).toBe(true);
    cur = await task();
    expect(cur.worklog?.[1]).toMatchObject({ note: "got the numbers" });
    expect((await app.editWorkNote(cur.id, cur.revision, 1, "")).ok).toBe(true); // empty removes it
    cur = await task();
    expect(cur.worklog).toHaveLength(1);

    await app.focusStart(cur.id);
    cur = await task();
    expect((await app.addWorkNote(cur.id, cur.revision, "mid-session")).ok).toBe(true); // auto-links to the running session
    cur = await task();
    expect(cur.worklog?.[2]).toMatchObject({ kind: "note", session: "2026-09-10T12:05:00.000Z" });
    expect((await app.addWorkNote(cur.id, cur.revision, "later", NOW)).ok).toBe(true); // explicit link to the first session
    expect((await app.addWorkNote(cur.id, cur.revision, "x", "2000-01-01T00:00:00.000Z")).ok).toBe(false);
    cur = await task();
    expect(cur.worklog?.[3]).toMatchObject({ session: NOW });
    expect((await app.focusComplete(cur.id, cur.revision)).ok).toBe(true);
    cur = await task();
    expect(cur.worklog?.map((e) => e.kind)).toEqual(["session", "session", "note", "note", "complete"]);
    expect(cur.worklog?.[1]).toMatchObject({ end: "2026-09-10T12:05:00.000Z" }); // second session closed before completion
  });
});
