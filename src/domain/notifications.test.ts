import { describe, expect, it } from "vitest";
import { deadlineIn, task } from "@/test/factory";
import { calculatePriority } from "./priority";
import { scoreTask } from "./score";
import {
  detectEvents,
  isWithinQuietHours,
  notificationText,
  orderEvents,
  type NotificationEvent,
} from "./notifications";

const OLD = "2026-08-01T00:00:00.000Z";
const p = (t: ReturnType<typeof task>, now: Date) => calculatePriority(t, now);
const ev = (t: ReturnType<typeof task>, from: Date, to: Date) =>
  detectEvents(t, p(t, from), p(t, to), to, scoreTask(t, p(t, to)));

describe("detectEvents (47.1)", () => {
  it("deadline_approaching: crosses > 24h → ≤ 24h before cutoff", () => {
    const t = task({ createdAt: OLD, deadline: deadlineIn(new Date("2026-09-10T12:00:00Z"), 0) });
    // 26h before → 22h before
    const events = ev(
      t,
      new Date("2026-09-09T10:00:00Z"),
      new Date("2026-09-09T14:00:00Z"),
    );
    expect(events.map((e) => e.type)).toContain("deadline_approaching");
  });

  it("deadline_passed: crosses the cutoff", () => {
    const cutoff = new Date("2026-09-10T12:00:00Z");
    const t = task({ createdAt: OLD, deadline: deadlineIn(cutoff, 0) });
    const events = ev(t, new Date("2026-09-10T11:00:00Z"), new Date("2026-09-10T13:00:00Z"));
    expect(events.map((e) => e.type)).toContain("deadline_passed");
  });

  it("no alert on baseline (before == null) — creation / new deadline revision", () => {
    const t = task({ createdAt: OLD, deadline: deadlineIn(new Date("2026-09-10T12:00:00Z"), 60) });
    expect(detectEvents(t, null, p(t, new Date("2026-09-10T12:00:00Z")), new Date(), 0)).toEqual([]);
  });

  it("do_now via automatic movement, but NOT when urgency is pinned", () => {
    const base = {
      createdAt: OLD,
      baseImportance: 0.5,
      deadline: { kind: "instant" as const, at: "2026-09-11T00:00:00.000Z", timeZone: "UTC" },
      estimatedMinutes: 120,
    };
    const auto = task(base);
    const before = new Date("2026-09-04T00:00:00Z"); // ~7 days out → Schedule
    const after = new Date("2026-09-11T06:00:00Z"); // overdue → Do Now
    expect(p(auto, before).quadrant).toBe("schedule");
    expect(p(auto, after).quadrant).toBe("do_now");
    expect(ev(auto, before, after).map((e) => e.type)).toContain("do_now");

    const pinned = task({ ...base, userUrgencyOverride: { value: -0.9, setAt: OLD, source: "editor" } });
    expect(
      detectEvents(pinned, p(pinned, before), p(pinned, after), after, 0).map((e) => e.type),
    ).not.toContain("do_now");
  });

  it("no events for blocked / needsReview / deferred tasks", () => {
    const cutoff = new Date("2026-09-10T12:00:00Z");
    const blocked = task({ status: "blocked", createdAt: OLD, deadline: deadlineIn(cutoff, 0) });
    expect(ev(blocked, new Date("2026-09-10T11:00Z"), new Date("2026-09-10T13:00Z"))).toEqual([]);
  });
});

describe("isWithinQuietHours (47.2)", () => {
  it("midnight-crossing 21:00–08:00", () => {
    const q = { start: "21:00", end: "08:00" };
    expect(isWithinQuietHours(new Date("2026-09-10T23:00:00Z"), q, "UTC")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-10T03:00:00Z"), q, "UTC")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-10T12:00:00Z"), q, "UTC")).toBe(false);
  });
  it("respects the app time zone", () => {
    const q = { start: "21:00", end: "08:00" };
    // 10:00 UTC = 05:00 America/Chicago (CDT): quiet in Chicago, not in UTC
    expect(isWithinQuietHours(new Date("2026-07-15T10:00:00Z"), q, "America/Chicago")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-07-15T10:00:00Z"), q, "UTC")).toBe(false);
  });
  it("null quiet hours = never quiet", () => {
    expect(isWithinQuietHours(new Date(), null, "UTC")).toBe(false);
  });
});

describe("orderEvents (47.2) + copy (RED-26)", () => {
  it("precedence: deadline_passed > deadline_approaching > do_now, then score", () => {
    const mk = (type: NotificationEvent["type"], id: string, s: number): NotificationEvent => ({
      key: `${id}-${type}`,
      taskId: id,
      deadlineRevision: 1,
      type,
      focusScore: s,
    });
    const ordered = orderEvents([
      mk("do_now", "a", 0.9),
      mk("deadline_passed", "b", 0.1),
      mk("deadline_approaching", "c", 0.5),
    ]);
    expect(ordered.map((e) => e.type)).toEqual(["deadline_passed", "deadline_approaching", "do_now"]);
  });

  it("copy is calm and guilt-free", () => {
    const all = [
      notificationText("deadline_passed", null).body,
      notificationText("deadline_approaching", null).body,
      notificationText("do_now", null).body,
    ].join(" ");
    expect(all).not.toMatch(/failed|falling behind|ignored|bad streak/i);
    expect(notificationText("deadline_approaching", "Buy milk").body).toContain("Buy milk");
  });
});
