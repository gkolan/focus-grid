import { describe, expect, it } from "vitest";
import { unwrap } from "@/test/unwrap";
import { createTask, nextOccurrence, patchTask, shiftDeadline } from "./commands";
import { isFocusEligible } from "./focus";
import { focusStats } from "./stats";
import { googleCalendarUrl, tasksToIcs } from "./ics";
import { PRIORITY_CONFIG, withTuning } from "./config";
import { calculatePriority } from "./priority";

const NOW = new Date("2026-09-11T10:00:00Z");
const CTX = new Set<string>();
const mk = (o: Partial<Parameters<typeof createTask>[0]> = {}) =>
  unwrap(createTask({ id: "t1", title: "Task", ...o }, NOW, CTX)).record;

describe("Task fields", () => {
  it("create + patch validate recurrence, tags, assignee, blockers", () => {
    const r = mk({ recurrence: { every: 2, unit: "week" }, tags: ["a", "a", " b "], assignee: "  ", blockedByIds: ["t1", "x"] });
    expect(r.task.recurrence).toEqual({ every: 2, unit: "week" });
    expect(r.task.tags).toEqual(["a", "b"]);
    expect(r.task.assignee).toBeNull();
    expect(r.task.blockedByIds).toEqual(["x"]); // self dropped
    expect(createTask({ id: "t2", title: "x", recurrence: { every: 0, unit: "day" } }, NOW, CTX).ok).toBe(false);
    expect(patchTask(r, { parentId: "t1" }, NOW, CTX).ok).toBe(false); // own parent
    const p = unwrap(patchTask(r, { tags: ["a", "b"] }, NOW, CTX));
    expect(p.events).toEqual([]); // unchanged extras = no-op
    const p2 = unwrap(patchTask(r, { assignee: "Sam" }, NOW, CTX));
    expect(p2.record.task.assignee).toBe("Sam");
    expect(p2.record.task.revision).toBe(2);
  });

  it("recurrence: next occurrence lands after now and clamps month ends", () => {
    expect(shiftDeadline({ kind: "date", date: "2026-01-31", timeZone: "UTC" }, { every: 1, unit: "month" })).toMatchObject({ date: "2026-02-28" });
    const t = mk({ deadline: { kind: "date", date: "2026-09-01", timeZone: "UTC" }, recurrence: { every: 1, unit: "week" } }).task;
    const next = nextOccurrence(t, "n", NOW)!;
    expect(next.deadline).toMatchObject({ date: "2026-09-15" }); // skipped 09-08 (already past)
    expect(next.recurrence).toEqual(t.recurrence);
    expect(nextOccurrence(mk().task, "n", NOW)).toBeNull();
  });

  it("focus excludes delegated tasks and tasks with open blockers", () => {
    const p = (t: ReturnType<typeof mk>["task"]) => calculatePriority(t, NOW);
    const base = { skipped: new Set<string>(), contextFilter: null };
    const del = mk({ assignee: "Sam" }).task;
    expect(isFocusEligible(del, p(del), NOW, base)).toBe(false);
    const blocked = mk({ blockedByIds: ["other"] }).task;
    expect(isFocusEligible(blocked, p(blocked), NOW, { ...base, openIds: new Set(["other"]) })).toBe(false);
    expect(isFocusEligible(blocked, p(blocked), NOW, { ...base, openIds: new Set() })).toBe(true);
  });
});

describe("stats / ics / tuning", () => {
  it("counts a streak ending today or yesterday", () => {
    const done = (iso: string) => ({ ...mk().task, status: "completed" as const, completedAt: iso, timeSpentMinutes: 10 });
    const s = focusStats([done("2026-09-10T12:00:00Z"), done("2026-09-09T12:00:00Z"), done("2026-09-05T12:00:00Z")], NOW, "UTC", 7);
    expect(s.streak).toBe(2);
    expect(s.completedTotal).toBe(3);
    expect(s.minutesSpent).toBe(30);
    expect(s.days.at(-2)).toEqual({ day: "2026-09-10", completed: 1 });
  });

  it("emits one VEVENT per dated open task with escaped text", () => {
    const t = mk({ title: "Pay; rent, now", deadline: { kind: "instant", at: "2026-09-12T09:00:00Z", timeZone: "UTC" }, estimatedMinutes: 30 }).task;
    const ics = tasksToIcs([t, mk().task], NOW);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("SUMMARY:Pay\\; rent\\, now");
    expect(ics).toContain("DTSTART:20260912T090000Z");
    expect(ics).toContain("DTEND:20260912T093000Z");
    expect(googleCalendarUrl(t)).toContain("dates=20260912T090000Z%2F20260912T093000Z");
  });

  it("normalises tuning weights and rejects nonsense", () => {
    const c = withTuning(PRIORITY_CONFIG, { deadlineWeight: 2, effortWeight: 1, overdueWeight: 1 });
    expect(c.deadlineWeight).toBeCloseTo(0.5);
    expect(withTuning(PRIORITY_CONFIG, { overdueSaturationMinutes: -5 }).overdueSaturationMinutes).toBe(PRIORITY_CONFIG.overdueSaturationMinutes);
    expect(withTuning(PRIORITY_CONFIG, null)).toBe(PRIORITY_CONFIG);
  });
});
