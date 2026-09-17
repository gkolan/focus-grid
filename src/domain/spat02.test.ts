/**
 * SPAT-02 everyday priority worksheet (SPATIAL_VALIDATION.md). Records the real
 * engine 1.0 output for ten everyday cases and asserts the cross-case invariants
 * the worksheet exists to check. The printed table is transcribed into
 * spec/evidence/02-spat.md. Constants are NOT tuned to these cases.
 */
import { describe, expect, it } from "vitest";
import { deadlineIn, task } from "@/test/factory";
import { calculatePriority, importanceLabel, urgencyLabel } from "./priority";
import { scoreTask } from "./score";

const NOW = new Date("2026-09-09T14:00:00.000Z"); // FIXTURE_NOW
const OLD = "2026-08-01T00:00:00.000Z";
const TZ = "America/Chicago";

type Case = { name: string; t: ReturnType<typeof task> };
const cases: Case[] = [
  { name: "Clean garage sometime", t: task({ createdAt: OLD, baseImportance: 0 }) },
  {
    name: "Proposal due in 10 days (High)",
    t: task({ createdAt: OLD, baseImportance: 0.6, deadline: deadlineIn(NOW, 14_400) }),
  },
  {
    name: "Interview prep tomorrow AM (High, est 180)",
    t: task({
      createdAt: OLD,
      baseImportance: 0.6,
      deadline: deadlineIn(NOW, 1_200),
      estimatedMinutes: 180,
    }),
  },
  {
    name: "Friday date-only form",
    t: task({
      createdAt: OLD,
      baseImportance: 0,
      deadline: { kind: "date", date: "2026-09-11", timeZone: TZ },
    }),
  },
  {
    name: "Ten-hour study, due +24h (High)",
    t: task({
      createdAt: OLD,
      baseImportance: 0.6,
      deadline: deadlineIn(NOW, 1_440),
      estimatedMinutes: 600,
      progress: 0,
      progressSource: "manual",
    }),
  },
  {
    name: "Five-minute email, due +24h (High)",
    t: task({
      createdAt: OLD,
      baseImportance: 0.6,
      deadline: deadlineIn(NOW, 1_440),
      estimatedMinutes: 5,
      progress: 0,
      progressSource: "manual",
    }),
  },
  {
    name: "4h presentation at 90%, due +24h (High)",
    t: task({
      createdAt: OLD,
      baseImportance: 0.6,
      deadline: deadlineIn(NOW, 1_440),
      estimatedMinutes: 240,
      progress: 0.9,
      progressSource: "manual",
    }),
  },
  {
    name: "Leak, handle now (undated, urgency pin +0.8, High)",
    t: task({
      createdAt: OLD,
      baseImportance: 0.6,
      baseUrgency: 0.8,
    }),
  },
  {
    name: "Old low-value task, cutoff -8d (Low)",
    t: task({ createdAt: OLD, baseImportance: -0.6, deadline: deadlineIn(NOW, -11_520) }),
  },
  {
    name: "Manual urgency pin -0.6 with due +24h (High)",
    t: task({
      createdAt: OLD,
      baseImportance: 0.6,
      deadline: deadlineIn(NOW, 1_440),
      userUrgencyOverride: { value: -0.6, setAt: OLD, source: "editor" },
    }),
  },
];

describe("SPAT-02 worksheet", () => {
  const rows: string[] = [
    "| Case | urg | imp | quadrant | remaining | dueMin | trend | score |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  ];
  const byName: Record<string, ReturnType<typeof calculatePriority> & { score: number }> = {};

  for (const c of cases) {
    const p = calculatePriority(c.t, NOW);
    const score = scoreTask(c.t, p);
    byName[c.name] = { ...p, score };
    rows.push(
      `| ${c.name} | ${p.urgency.toFixed(4)} | ${p.importance.toFixed(2)} | ${p.quadrant} ` +
        `(${importanceLabel(p.importance)}/${urgencyLabel(p.urgency, p.timePressureDelta)}) | ` +
        `${p.remainingMinutes == null ? "—" : p.remainingMinutes.toFixed(0)} | ` +
        `${p.minutesToDeadline == null ? "—" : p.minutesToDeadline.toFixed(0)} | ` +
        `${p.timePressureDelta.toFixed(4)} | ${score.toFixed(4)} |`,
    );
  }

  it("prints the worksheet", () => {
    console.log("\n" + rows.join("\n") + "\n");
    expect(rows.length).toBe(cases.length + 2);
  });

  it("longer remaining effort yields greater urgency (study > email)", () => {
    expect(byName["Ten-hour study, due +24h (High)"].automaticUrgency).toBeGreaterThan(
      byName["Five-minute email, due +24h (High)"].automaticUrgency,
    );
  });

  it("4h presentation at 90% has 24 min remaining, not 240", () => {
    expect(byName["4h presentation at 90%, due +24h (High)"].remainingMinutes).toBeCloseTo(24);
  });

  it("explicit undated urgency pin +0.8 survives with no deadline", () => {
    const p = byName["Leak, handle now (undated, urgency pin +0.8, High)"];
    expect(p.urgency).toBe(0.8);
    expect(p.minutesToDeadline).toBeNull();
    expect(p.overdue).toBe(false);
  });

  it("old low-value overdue task needs review (Focus-ineligible) and keeps its importance", () => {
    const p = byName["Old low-value task, cutoff -8d (Low)"];
    expect(p.needsReview).toBe(true);
    expect(p.importance).toBe(-0.6);
  });

  it("manual urgency pin fixes effective urgency; deadline still influences score", () => {
    const pinned = byName["Manual urgency pin -0.6 with due +24h (High)"];
    expect(pinned.urgency).toBe(-0.6);
    expect(pinned.deadlinePressure).toBeGreaterThan(0); // score's deadlineRisk term is live
  });

  it("same values in different contexts produce identical priority (no domain bias)", () => {
    const work = calculatePriority(task({ createdAt: OLD, contextId: "w", baseImportance: 0.2 }), NOW);
    const family = calculatePriority(
      task({ createdAt: OLD, contextId: "f", baseImportance: 0.2 }),
      NOW,
    );
    expect(work.urgency).toBe(family.urgency);
    expect(work.importance).toBe(family.importance);
  });
});
