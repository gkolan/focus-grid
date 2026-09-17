import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { openFocusGridDB, DEMO_DB_NAME } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { FocusGridApp } from "./service";
import { seedDemo } from "./demo";
import { isDueIn } from "@/domain/focus";

it("seeds concise, naturally distributed examples across all four quadrants", async () => {
  globalThis.indexedDB = new IDBFactory();
  const opened = await openFocusGridDB(DEMO_DB_NAME);
  if (!opened.ok) throw new Error(opened.code);
  const now = new Date("2026-09-11T12:00:00Z");
  const app = new FocusGridApp(new TaskRepository(opened.db, undefined, {}), new FakeClock(now.toISOString()), opened.db);
  await seedDemo(app, now);
  const views = await app.allViews();
  expect(views.length).toBeGreaterThan(90);
  expect(views.filter(v => v.record.task.status === "completed").length).toBeGreaterThanOrEqual(30); // 11 curated + overdue filler + every third upcoming filler
  for (const quadrant of ["do_now", "schedule", "delegate", "ignore"]) {
    expect(views.filter(v => v.priority.quadrant === quadrant).length).toBeGreaterThanOrEqual(11);
  }
  for (const { record: { task }, priority } of views) {
    expect(task.title.length).toBeLessThanOrEqual(26);
    expect(Math.abs(priority.importance)).toBeGreaterThanOrEqual(0.2);
    expect(Math.abs(priority.urgency)).toBeGreaterThan(0.08);
    expect(task.userImportanceOverride).toBeNull();
    expect(task.userUrgencyOverride).toBeNull();
  }
  expect(new Set(views.map(v => v.priority.urgency)).size).toBeGreaterThan(20); // overdue/far-out deadlines clamp to ±1
  // Calendar shape: 2 yesterday, 8 today, 3 tomorrow (local days); Work never on a weekend.
  const dayOf = (iso: string) => Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const days = views.flatMap(v => v.record.task.deadline?.kind === "instant" ? [dayOf(v.record.task.deadline.at)] : []);
  expect([-1, 0, 1].map(d => days.filter(x => x === d).length)).toEqual([2, 8, 2]);
  // Every quadrant has something open today (>= 1) and this week (>= 3), so no view opens on an empty section.
  const open = views.filter(v => v.record.task.status !== "completed");
  for (const [days, min] of [[1, 1], [7, 3]] as const) {
    const w = { start: new Date(now).setHours(0, 0, 0, 0), end: new Date(now).setHours(0, 0, 0, 0) + days * 86_400_000, includeOverdue: true };
    for (const q of ["do_now", "schedule", "delegate", "ignore"]) expect(open.filter(v => isDueIn(v.record.task, w) && v.priority.quadrant === q).length).toBeGreaterThanOrEqual(min);
  }
  // A week is never overwhelming: coming 7 days + still-open overdue ≤ 20.
  const weekLoad = views.filter(v => {
    if (v.record.task.deadline?.kind !== "instant") return false;
    const d = dayOf(v.record.task.deadline.at);
    return (d >= 0 && d < 7) || (d < 0 && v.record.task.status !== "completed");
  }).length;
  expect(weekLoad).toBeLessThanOrEqual(20);
  expect(Math.min(...days)).toBeLessThan(-30);
  expect(Math.max(...days)).toBeGreaterThan(60);
  for (const v of views) {
    if (v.contextName === "Work" && v.record.task.deadline?.kind === "instant") expect([0, 6]).not.toContain(new Date(v.record.task.deadline.at).getDay());
  }
  opened.db.close();
});
