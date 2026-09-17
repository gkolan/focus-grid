import { describe, expect, it } from "vitest";
import { deadlineIn, task } from "@/test/factory";
import { calculatePriority } from "./priority";
import {
  type Candidate,
  focusRationale,
  isFocusEligible,
  rankFocus,
  resolveFocus,
} from "./focus";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const OLD = "2026-08-01T00:00:00.000Z";
const noSession = { skipped: new Set<string>(), contextFilter: null };

function cand(overrides: Parameters<typeof task>[0] = {}): Candidate {
  const t = task({ createdAt: OLD, ...overrides });
  return { task: t, priority: calculatePriority(t, NOW) };
}

describe("isFocusEligible (44.1)", () => {
  it("excludes blocked / completed / archived / needsReview / deferred / skipped", () => {
    expect(isFocusEligible(cand().task, cand().priority, NOW, noSession)).toBe(true);
    expect(isFocusEligible(cand({ status: "blocked" }).task, cand().priority, NOW, noSession)).toBe(false);
    expect(isFocusEligible(cand({ status: "completed" }).task, cand().priority, NOW, noSession)).toBe(false);
    expect(isFocusEligible(cand({ status: "archived" }).task, cand().priority, NOW, noSession)).toBe(false);

    const stale = cand({ deadline: deadlineIn(NOW, -20_000) });
    expect(stale.priority.needsReview).toBe(true);
    expect(isFocusEligible(stale.task, stale.priority, NOW, noSession)).toBe(false);

    const c = cand();
    expect(isFocusEligible(c.task, c.priority, NOW, { skipped: new Set([c.task.id]), contextFilter: null })).toBe(false);
  });

  it("RED-57: startAt exactly now is eligible; one ms later is deferred", () => {
    const atNow = cand({ startAt: NOW.toISOString() });
    expect(isFocusEligible(atNow.task, atNow.priority, NOW, noSession)).toBe(true);
    const later = cand({ startAt: new Date(NOW.getTime() + 1).toISOString() });
    expect(isFocusEligible(later.task, later.priority, NOW, noSession)).toBe(false);
  });

  it("RED-62: a Focus context filter is separate — grid visibility is not consulted", () => {
    const work = cand({ contextId: "work" });
    const family = cand({ contextId: "family", id: "f1" });
    const filter = { skipped: new Set<string>(), contextFilter: new Set(["family"]) };
    expect(isFocusEligible(work.task, work.priority, NOW, filter)).toBe(false);
    expect(isFocusEligible(family.task, family.priority, NOW, filter)).toBe(true);
  });
});

describe("rankFocus (44.2)", () => {
  it("RED-61: identical scores break by earliest deadline, then createdAt, then id", () => {
    const a: Candidate = {
      task: task({ id: "b", createdAt: "2026-08-02T00:00:00Z", deadline: deadlineIn(NOW, 5000), baseImportance: 0.3 }),
      priority: calculatePriority(task({ id: "b" }), NOW),
    };
    const b: Candidate = {
      task: task({ id: "a", createdAt: "2026-08-01T00:00:00Z", deadline: deadlineIn(NOW, 5000), baseImportance: 0.3 }),
      priority: calculatePriority(task({ id: "a" }), NOW),
    };
    // Force equal scores by using the same priority object shape.
    a.priority = { ...a.priority };
    b.priority = { ...b.priority };
    const ranked = rankFocus([a, b]);
    // equal score, equal deadline → earliest createdAt first → "a"
    expect(ranked[0].task.id).toBe("a");
  });

  it("null deadline sorts last on a score tie", () => {
    const withDl: Candidate = {
      task: task({ id: "dl", deadline: deadlineIn(NOW, 3000) }),
      priority: calculatePriority(task(), NOW),
    };
    const noDl: Candidate = { task: task({ id: "no" }), priority: calculatePriority(task(), NOW) };
    withDl.priority = { ...noDl.priority }; // equal score
    const ranked = rankFocus([noDl, withDl]);
    expect(ranked[0].task.id).toBe("dl");
  });

  it("higher importance outranks higher urgency (weights 0.50 vs 0.35)", () => {
    const important = cand({ baseImportance: 0.9, baseUrgency: -0.9 });
    const urgent = cand({ baseImportance: -0.9, baseUrgency: 0.9, id: "u" });
    const ranked = rankFocus([urgent, important]);
    expect(ranked[0].task.id).toBe(important.task.id);
  });
});

describe("resolveFocus (44.3)", () => {
  it("RED-63: a started task stays current even when another task outranks it", () => {
    const started = cand({ id: "started", baseImportance: 0.1 });
    const better = cand({ id: "better", baseImportance: 0.9 });
    const r = resolveFocus([started, better], NOW, { ...noSession, startedTaskId: "started" }, 2);
    expect(r.current?.task.id).toBe("started");
    expect(r.recommendationChanged).toBe(true);
  });

  it("RED-64: started task becoming ineligible clears focus and offers the next candidate", () => {
    const started = cand({ id: "started", status: "completed" });
    const next = cand({ id: "next", baseImportance: 0.5 });
    const r = resolveFocus([started, next], NOW, { ...noSession, startedTaskId: "started" }, 2);
    expect(r.current?.task.id).toBe("next");
  });

  it("RED-60: all eligible skipped → all_skipped reason, no auto-repeat", () => {
    const a = cand({ id: "a" });
    const b = cand({ id: "b" });
    const r = resolveFocus([a, b], NOW, { skipped: new Set(["a", "b"]), contextFilter: null, startedTaskId: null }, 2);
    expect(r.current).toBeNull();
    expect(r.emptyReason).toBe("all_skipped");
  });

  it("distinguishes empty database from no-actionable from filter-empty", () => {
    expect(resolveFocus([], NOW, { ...noSession, startedTaskId: null }, 0).emptyReason).toBe("empty_database");
    const blocked = cand({ id: "x", status: "blocked" });
    expect(
      resolveFocus([blocked], NOW, { ...noSession, startedTaskId: null }, 1).emptyReason,
    ).toBe("no_actionable");
    const work = cand({ id: "w", contextId: "work" });
    expect(
      resolveFocus([work], NOW, { skipped: new Set(), contextFilter: new Set(["family"]), startedTaskId: null }, 1)
        .emptyReason,
    ).toBe("filter_empty");
  });
});

describe("focusRationale (44.4)", () => {
  it("never claims enough time; surfaces pin vs automatic; handles unknown estimate", () => {
    const pinned = task({
      createdAt: OLD,
      deadline: deadlineIn(NOW, 1000),
      userUrgencyOverride: { value: -0.6, setAt: OLD, source: "editor" },
    });
    const lines = focusRationale(pinned, calculatePriority(pinned, NOW)).join(" ");
    expect(lines).toMatch(/pinned by hand/i);
    expect(lines).toMatch(/Estimate unknown/i);
    expect(lines).not.toMatch(/enough time/i);
  });
});
