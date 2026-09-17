import { describe, expect, it } from "vitest";
import { type HistorySnapshot, shouldSnapshot } from "./history";

const base: HistorySnapshot = {
  taskId: "t1",
  sequence: 0,
  taskRevision: 1,
  timestamp: "2026-09-10T12:00:00.000Z",
  importance: 0,
  urgency: -0.6,
  automaticUrgency: -0.6,
  deadlinePressure: 0,
  effortPressure: 0,
  overduePressure: 0,
  reason: ["created"],
  engineVersion: "1.0",
  importancePinned: false,
  urgencyPinned: false,
};

const flags = { quadrant: "schedule", critical: false, needsReview: false };

describe("shouldSnapshot (42.3)", () => {
  it("first snapshot is always appended as 'created'", () => {
    const d = shouldSnapshot(
      { importance: 0, urgency: -0.6, quadrant: "schedule", critical: false, needsReview: false },
      [],
      null,
      null,
    );
    expect(d.append).toBe(true);
    expect(d.reasons).toContain("created");
  });

  it("human edit reasons force an append even with no coordinate move", () => {
    const d = shouldSnapshot(
      { importance: 0, urgency: -0.6, quadrant: "schedule", critical: false, needsReview: false },
      ["deadline_changed"],
      base,
      flags,
    );
    expect(d.append).toBe(true);
    expect(d.reasons).toContain("deadline_changed");
  });

  it("RED-43: sub-threshold time motion does not append until cumulative ≥ 0.05", () => {
    // urgency drifts -0.6 -> -0.56 (0.04) => no append; baseline stays `base`
    let d = shouldSnapshot(
      { importance: 0, urgency: -0.56, quadrant: "schedule", critical: false, needsReview: false },
      [],
      base,
      flags,
    );
    expect(d.append).toBe(false);
    // later -0.6 -> -0.54 (0.06 vs the SAME meaningful baseline) => append
    d = shouldSnapshot(
      { importance: 0, urgency: -0.54, quadrant: "schedule", critical: false, needsReview: false },
      [],
      base,
      flags,
    );
    expect(d.append).toBe(true);
    expect(d.reasons).toContain("time_pressure");
  });

  it("quadrant / critical transitions append", () => {
    const d = shouldSnapshot(
      { importance: 0.1, urgency: 0.1, quadrant: "do_now", critical: false, needsReview: false },
      [],
      base,
      flags,
    );
    expect(d.append).toBe(true);
    expect(d.reasons).toContain("quadrant_changed");
  });

  it("no reason, no move, no transition → no append (heartbeat no-op)", () => {
    const d = shouldSnapshot(
      { importance: 0, urgency: -0.6, quadrant: "schedule", critical: false, needsReview: false },
      [],
      base,
      flags,
    );
    expect(d.append).toBe(false);
  });
});
