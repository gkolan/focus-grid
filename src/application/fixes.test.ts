import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { unwrap } from "@/test/unwrap";
import { FocusGridApp } from "./service";
import { shiftDeadline } from "@/domain/commands";
import { googleCalendarUrl, tasksToIcs } from "@/domain/ics";
import { parseDeadline, zonedToInstant } from "@/persistence/importers";

const NOW = "2026-09-10T12:00:00.000Z";
async function makeApp() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return new FocusGridApp(new TaskRepository(o.db), new FakeClock(NOW), o.db);
}
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("Review fixes", () => {
  it("undoing a recurring completion also removes the spawned occurrence", async () => {
    const app = await makeApp();
    const r = unwrap(await app.createManualTask({ title: "Water", importance: "untouched", deadline: { kind: "date", date: "2026-09-10", timeZone: "UTC" }, recurrence: { every: 1, unit: "week" } }));
    unwrap(await app.complete(r.id, r.revision));
    expect((await app.allViews()).length).toBe(2);
    unwrap(await app.undoLast());
    const views = await app.allViews();
    expect(views).toHaveLength(1);
    expect(views[0].record.task.status).toBe("active");
  });

  it("pausing the focus timer is not an undo step", async () => {
    const app = await makeApp();
    const r = unwrap(await app.createManualTask({ title: "Timed", importance: "medium" }));
    unwrap(await app.edit(r.id, r.revision, { title: "Timed!" }));
    await app.focusStart(r.id);
    await app.focusPause();
    expect(app.canUndo()).toBe("Timed"); // the edit, not the pause
  });

  it("refuses parent and blocker cycles", async () => {
    const app = await makeApp();
    const a = unwrap(await app.createManualTask({ title: "A", importance: "medium" }));
    const b = unwrap(await app.createManualTask({ title: "B", importance: "medium", parentId: a.id }));
    const c = unwrap(await app.createManualTask({ title: "C", importance: "medium", parentId: b.id }));
    const cyc = await app.edit(a.id, a.revision, { parentId: c.id });
    expect(cyc.ok).toBe(false);
    const x = unwrap(await app.createManualTask({ title: "X", importance: "medium" }));
    const y = unwrap(await app.createManualTask({ title: "Y", importance: "medium", blockedByIds: [x.id] }));
    const bad = await app.edit(x.id, x.revision, { blockedByIds: [y.id] });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? "" : bad.error.field).toBe("blockedByIds");
  });

  it("nested projects inherit the deepest child's urgency regardless of creation order", async () => {
    const app = await makeApp();
    const grand = unwrap(await app.createManualTask({ title: "Grand", importance: "untouched" }));
    const parent = unwrap(await app.createManualTask({ title: "Parent", importance: "untouched", parentId: grand.id }));
    unwrap(await app.createManualTask({ title: "Leaf", importance: "untouched", parentId: parent.id, deadline: { kind: "instant", at: "2026-09-10T13:00:00.000Z", timeZone: "UTC" } }));
    const views = await app.allViews();
    const u = (t: string) => views.find((v) => v.record.task.title === t)!.priority.urgency;
    expect(u("Grand")).toBeCloseTo(u("Leaf"), 6);
  });

  it("monthly recurrence keeps the wall-clock day in the deadline's zone", () => {
    // Jan 31, 23:30 in Chicago is Feb 1 05:30Z — stepping a month must give Feb 28 23:30 Chicago, not Mar 1
    const d = shiftDeadline({ kind: "instant", at: "2026-02-01T05:30:00.000Z", timeZone: "America/Chicago" }, { every: 1, unit: "month" });
    expect(d.kind === "instant" && d.at).toBe("2026-03-01T05:30:00.000Z"); // = Feb 28 23:30 CST
  });

  it("CSV naive datetimes are read in the chosen zone; all-day Google links end the next day; ICS folds by octets", () => {
    expect(parseDeadline("2026-07-01 09:00", "America/Chicago")).toMatchObject({ at: "2026-07-01T14:00:00.000Z" });
    expect(zonedToInstant("2026-01-15", 9, 0, "Asia/Tokyo").toISOString()).toBe("2026-01-15T00:00:00.000Z");
    const task = { id: "t", title: "日本語のタイトル".repeat(6), notes: "", status: "active", deadline: { kind: "date", date: "2026-09-10", timeZone: "UTC" } } as unknown as Parameters<typeof googleCalendarUrl>[0];
    expect(googleCalendarUrl(task)).toContain("dates=20260910%2F20260911");
    for (const line of tasksToIcs([task], new Date(NOW)).split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
