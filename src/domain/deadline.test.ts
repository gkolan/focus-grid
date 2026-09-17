import { describe, expect, it } from "vitest";
import {
  dueRangeShift,
  dueRangeStart,
  dueWindow,
  addDays,
  deadlineCutoffMs,
  isOverdue,
  zonedWallTimeToUtc,
} from "./deadline";

describe("date-only cutoff (40.1)", () => {
  it("RED-46: due Sep 11 America/Chicago is not overdue at 23:59 local, overdue at next midnight", () => {
    const d = { kind: "date" as const, date: "2026-09-11", timeZone: "America/Chicago" };
    // 2026-09-11 23:59 CDT = 2026-09-12 04:59Z
    expect(isOverdue(d, new Date("2026-09-12T04:59:00Z"))).toBe(false);
    // 2026-09-12 00:00 CDT = 2026-09-12 05:00Z
    expect(isOverdue(d, new Date("2026-09-12T05:00:00Z"))).toBe(true);
    expect(deadlineCutoffMs(d)).toBe(Date.parse("2026-09-12T05:00:00Z"));
  });

  it("RED-47: DST spring-forward — cutoff is next local midnight, not +24h", () => {
    // US DST 2026: forward on 2026-03-08. A task due 2026-03-07 (Chicago) becomes
    // overdue at 2026-03-08 00:00 CST = 06:00Z (that day is only 23h long later).
    const d = { kind: "date" as const, date: "2026-03-07", timeZone: "America/Chicago" };
    expect(deadlineCutoffMs(d)).toBe(Date.parse("2026-03-08T06:00:00Z"));
  });

  it("month/year rollover", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 not a leap year
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("non-hour offset zone (India, +05:30)", () => {
    const d = { kind: "date" as const, date: "2026-06-01", timeZone: "Asia/Kolkata" };
    expect(deadlineCutoffMs(d)).toBe(Date.parse("2026-06-01T18:30:00Z"));
  });
});

describe("RED-48: nonexistent / ambiguous local times", () => {
  it("spring-forward gap is flagged nonexistent", () => {
    // 2026-03-08 02:30 does not exist in America/Chicago.
    const r = zonedWallTimeToUtc(2026, 3, 8, 2, 30, 0, "America/Chicago");
    expect(r.outcome).toBe("nonexistent");
  });
  it("fall-back hour is flagged ambiguous with two instants", () => {
    // 2026-11-01 01:30 occurs twice in America/Chicago.
    const r = zonedWallTimeToUtc(2026, 11, 1, 1, 30, 0, "America/Chicago");
    expect(r.outcome).toBe("ambiguous");
    expect(r.second).toBeGreaterThan(r.utc);
  });
  it("an ordinary local time resolves cleanly", () => {
    const r = zonedWallTimeToUtc(2026, 6, 15, 9, 0, 0, "America/Chicago");
    expect(r.outcome).toBe("ok");
    expect(r.utc).toBe(Date.parse("2026-06-15T14:00:00Z"));
  });
});

describe("instant deadlines", () => {
  it("RED-50: changing display zone does not change an instant cutoff", () => {
    const d = { kind: "instant" as const, at: "2026-09-15T09:00:00.000Z", timeZone: "America/Chicago" };
    expect(deadlineCutoffMs(d)).toBe(Date.parse("2026-09-15T09:00:00.000Z"));
  });
});

describe("dueWindow", () => {
  const tz = "America/Chicago";
  it("computes period start, shift, window and label", () => {
    expect(dueRangeStart("week", "2026-09-13")).toBe("2026-09-13"); // Sunday starts the week
    expect(dueRangeStart("week", "2026-09-16")).toBe("2026-09-13"); // Wednesday → Sunday
    expect(dueRangeStart("month", "2026-09-13")).toBe("2026-09-01");
    expect(dueRangeShift("month", "2026-12-01", 1)).toBe("2027-01-01");
    const w = dueWindow("day", "2026-09-14", tz);
    expect(new Date(w.start).toISOString()).toBe("2026-09-14T05:00:00.000Z");
    expect(new Date(w.end).toISOString()).toBe("2026-09-15T05:00:00.000Z");
    expect(w.label).toBe("Sep 14, 2026");
    expect(dueWindow("week", "2026-09-13", tz).label).toBe("Sep 13 – 19, 2026");
    expect(dueWindow("week", "2026-09-27", tz).label).toBe("Sep 27 – Oct 3, 2026");
    expect(dueWindow("month", "2026-09-01", tz).label).toBe("Sep 2026");
  });
});
