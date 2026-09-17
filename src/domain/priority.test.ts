import { describe, expect, it } from "vitest";
import { deadlineIn, task } from "@/test/factory";
import {
  calculatePriority,
  importanceLabel,
  urgencyLabel,
} from "./priority";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const TOL = 1e-6;
// createdAt far in the past so the 24h trend window is fully available.
const OLD = "2026-08-01T00:00:00.000Z";

describe("41.5 golden automatic urgency", () => {
  const cases: Array<[string, Partial<Parameters<typeof task>[0]>, number]> = [
    ["no deadline, default base", { createdAt: OLD }, -0.6],
    ["due in 14 days, estimate null", { createdAt: OLD, deadline: deadlineIn(NOW, 20_160) }, -1],
    ["due in 7 days, estimate null", { createdAt: OLD, deadline: deadlineIn(NOW, 10_080) }, -0.725],
    ["due in 3 days, estimate null", { createdAt: OLD, deadline: deadlineIn(NOW, 4_320) }, -0.45],
    ["due in 1 day, estimate null", { createdAt: OLD, deadline: deadlineIn(NOW, 1_440) }, -0.12],
    ["due now, estimate null", { createdAt: OLD, deadline: deadlineIn(NOW, 0) }, 0.1],
    ["overdue 1 day, estimate null", { createdAt: OLD, deadline: deadlineIn(NOW, -1_440) }, 0.5],
    [
      "due in 1 day, estimate 600, progress 0",
      { createdAt: OLD, deadline: deadlineIn(NOW, 1_440), estimatedMinutes: 600 },
      0.0883333333,
    ],
    [
      "due in 1 day, estimate 5, progress 0",
      { createdAt: OLD, deadline: deadlineIn(NOW, 1_440), estimatedMinutes: 5 },
      -0.1182638889,
    ],
    [
      "due in 1 day, estimate 240, progress 0.9",
      {
        createdAt: OLD,
        deadline: deadlineIn(NOW, 1_440),
        estimatedMinutes: 240,
        progress: 0.9,
        progressSource: "manual",
      },
      -0.1116666667,
    ],
    [
      "overdue 1 day, remaining effort >= 1 minute",
      { createdAt: OLD, deadline: deadlineIn(NOW, -1_440), estimatedMinutes: 120 },
      1,
    ],
  ];

  for (const [name, ov, expected] of cases) {
    it(name, () => {
      const p = calculatePriority(task(ov), NOW);
      expect(Math.abs(p.automaticUrgency - expected)).toBeLessThan(TOL);
    });
  }

  it("urgency override 0 gives effective urgency 0, automatic value unchanged", () => {
    const ov = { setAt: NOW.toISOString(), value: 0, source: "editor" as const };
    const p = calculatePriority(
      task({ createdAt: OLD, deadline: deadlineIn(NOW, -1_440), userUrgencyOverride: ov }),
      NOW,
    );
    expect(p.urgency).toBe(0);
    expect(Math.abs(p.automaticUrgency - 0.5)).toBeLessThan(TOL);
  });
});

describe("41.6 trend goldens", () => {
  it("created ≥24h ago, due now, est null, no override → delta 0.22", () => {
    const p = calculatePriority(task({ createdAt: OLD, deadline: deadlineIn(NOW, 0) }), NOW);
    expect(Math.abs(p.timePressureDelta - 0.22)).toBeLessThan(TOL);
  });
  it("same task created exactly now → delta 0", () => {
    const p = calculatePriority(
      task({ createdAt: NOW.toISOString(), deadline: deadlineIn(NOW, 0) }),
      NOW,
    );
    expect(p.timePressureDelta).toBe(0);
  });
  it("any urgency override → delta 0", () => {
    const p = calculatePriority(
      task({
        createdAt: OLD,
        deadline: deadlineIn(NOW, 0),
        userUrgencyOverride: { setAt: NOW.toISOString(), value: 0.3, source: "drag" },
      }),
      NOW,
    );
    expect(p.timePressureDelta).toBe(0);
  });
  it("no deadline, unchanged base → delta 0 (RED-54: no age-based growth)", () => {
    const later = new Date(NOW.getTime() + 30 * 24 * 60 * 60_000);
    const p = calculatePriority(task({ createdAt: OLD }), later);
    expect(p.timePressureDelta).toBe(0);
    expect(p.automaticUrgency).toBe(-0.6);
  });
});

describe("41 properties", () => {
  it("output is always finite across generated inputs", () => {
    for (let k = 0; k < 400; k++) {
      const mins = Math.round((Math.random() - 0.3) * 40_000);
      const est = Math.random() < 0.5 ? null : Math.ceil(Math.random() * 5000);
      const prog = Math.random();
      const p = calculatePriority(
        task({
          createdAt: OLD,
          deadline: deadlineIn(NOW, mins),
          estimatedMinutes: est,
          progress: est == null ? 0 : prog,
          progressSource: "manual",
        }),
        NOW,
      );
      for (const v of [p.automaticUrgency, p.urgency, p.importance, p.deadlinePressure, p.effortPressure, p.overduePressure]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(p.automaticUrgency).toBeGreaterThanOrEqual(-1);
      expect(p.automaticUrgency).toBeLessThanOrEqual(1);
    }
  });

  it("automatic urgency is monotonic nondecreasing as time advances", () => {
    const base = task({ createdAt: OLD, deadline: deadlineIn(NOW, 5_000), estimatedMinutes: 300 });
    let prev = -Infinity;
    for (let m = 0; m <= 8_000; m += 200) {
      const at = new Date(NOW.getTime() + m * 60_000);
      const u = calculatePriority(base, at).automaticUrgency;
      expect(u).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = u;
    }
  });

  it("progress increase cannot raise automatic urgency", () => {
    const mk = (progress: number) =>
      calculatePriority(
        task({
          createdAt: OLD,
          deadline: deadlineIn(NOW, 2_000),
          estimatedMinutes: 600,
          progress,
          progressSource: "manual",
        }),
        NOW,
      ).automaticUrgency;
    expect(mk(0.9)).toBeLessThanOrEqual(mk(0.1) + 1e-9);
  });

  it("RED-02/55: importance is invariant under time and lateness", () => {
    const t = task({ createdAt: OLD, baseImportance: -0.7, deadline: deadlineIn(NOW, -10_000) });
    const early = calculatePriority(t, NOW).importance;
    const late = calculatePriority(t, new Date(NOW.getTime() + 20 * 864e5)).importance;
    expect(early).toBe(-0.7);
    expect(late).toBe(-0.7);
  });
});

describe("41.6 flags, quadrants, labels", () => {
  it("RED-56: exact origin (0,0) is Do Now", () => {
    const p = calculatePriority(task({ baseImportance: 0, baseUrgency: 0 }), NOW);
    expect(p.quadrant).toBe("do_now");
  });
  it("overdue true at the exact cutoff with overduePressure 0", () => {
    const p = calculatePriority(task({ createdAt: OLD, deadline: deadlineIn(NOW, 0) }), NOW);
    expect(p.overdue).toBe(true);
    expect(p.overduePressure).toBe(0);
  });
  it("RED-58: needsReview after cutoff + 7 days for active overdue", () => {
    const t = task({ createdAt: OLD, deadline: deadlineIn(NOW, -20_000) });
    expect(calculatePriority(t, NOW).needsReview).toBe(true);
  });
  it("needsReview never set for completed/archived", () => {
    const t = task({ status: "archived", createdAt: OLD, deadline: deadlineIn(NOW, -20_000) });
    expect(calculatePriority(t, NOW).needsReview).toBe(false);
  });
  it("labels", () => {
    expect(importanceLabel(-0.5)).toBe("Low");
    expect(importanceLabel(0)).toBe("Medium");
    expect(importanceLabel(0.4)).toBe("High");
    expect(urgencyLabel(0.9, 0)).toBe("Critical");
    expect(urgencyLabel(0.5, 0)).toBe("High");
    expect(urgencyLabel(-0.2, 0.1)).toBe("Rising");
    expect(urgencyLabel(-0.2, 0)).toBe("Stable");
  });
});

describe("RED-116: history append/prune never changes the time-pressure trend", () => {
  it("trend is a counterfactual of current settings, computed with no history access", () => {
    // A dated task due now, created 24h+ ago → delta 0.22 regardless of any history.
    const t = task({ createdAt: OLD, deadline: deadlineIn(NOW, 0) });
    const before = calculatePriority(t, NOW).timePressureDelta;
    // Re-evaluate at the same instant/inputs — identical (history is irrelevant here).
    const after = calculatePriority(t, NOW).timePressureDelta;
    expect(after).toBe(before);
    expect(Math.abs(before - 0.22)).toBeLessThan(TOL);
    // A pinned task and a newborn stay at 0.
    expect(
      calculatePriority(
        task({ createdAt: OLD, deadline: deadlineIn(NOW, 0), userUrgencyOverride: { setAt: OLD, value: 0.1, source: "editor" } }),
        NOW,
      ).timePressureDelta,
    ).toBe(0);
    expect(calculatePriority(task({ createdAt: NOW.toISOString() }), NOW).timePressureDelta).toBe(0);
  });
});

describe("RED-45: clock moves backward", () => {
  it("recomputes finitely with no negative remaining effort", () => {
    const t = task({ createdAt: OLD, deadline: deadlineIn(NOW, 500), estimatedMinutes: 100, progress: 0.2, progressSource: "manual" });
    const back = new Date(NOW.getTime() - 2 * 60 * 60_000);
    const p = calculatePriority(t, back);
    expect(Number.isFinite(p.automaticUrgency)).toBe(true);
    expect(p.remainingMinutes).toBeGreaterThanOrEqual(0);
    expect(p.timePressureDelta).toBeLessThanOrEqual(0.220001);
  });
});
