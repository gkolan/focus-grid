import { describe, expect, it } from "vitest";
import { interpretRequestSchema, validateProposal } from "./schema";

const INPUT = "Prepare interview Friday for 3 hours.";
const REQ = { input: INPUT, contexts: [{ id: "ctx-work", name: "Work" }] };
const nf = { value: null, confidence: null, rationale: null, ambiguity: null, sourceText: null };
const base = (over: Record<string, unknown>) => ({
  schemaVersion: "1",
  fields: {
    title: nf,
    notes: nf,
    deadline: nf,
    startAt: nf,
    estimatedMinutes: nf,
    contextId: nf,
    baseImportance: nf,
    baseUrgency: nf,
    ...over,
  },
});

describe("interpretRequestSchema (43.1)", () => {
  it("rejects unknown keys and over-long input", () => {
    expect(
      interpretRequestSchema.safeParse({
        schemaVersion: "1",
        purpose: "create",
        input: "hi",
        referenceNow: "2026-09-09T14:00:00.000Z",
        timeZone: "America/Chicago",
        contexts: [],
        evil: 1,
      }).success,
    ).toBe(false);
    expect(
      interpretRequestSchema.safeParse({
        schemaVersion: "1",
        purpose: "create",
        input: "x".repeat(4001),
        referenceNow: "2026-09-09T14:00:00.000Z",
        timeZone: "America/Chicago",
        contexts: [],
      }).success,
    ).toBe(false);
  });
});

describe("validateProposal (43.6)", () => {
  it("accepts the canonical dated fixture (urgency null)", () => {
    const raw = base({
      title: { value: "Prepare interview", confidence: 0.95, rationale: "names it", ambiguity: null, sourceText: "Prepare interview" },
      deadline: { value: { kind: "date", date: "2026-09-11", timeZone: "America/Chicago" }, confidence: 0.95, rationale: "Friday", ambiguity: null, sourceText: "Friday" },
      estimatedMinutes: { value: 180, confidence: 0.95, rationale: "3h", ambiguity: null, sourceText: "3 hours" },
    });
    const r = validateProposal(raw, REQ);
    expect(r.ok).toBe(true);
  });

  it("RED-67: an extra progress key anywhere rejects the whole proposal", () => {
    const raw = base({ title: { ...nf, value: "X", confidence: 0.9, sourceText: "Prepare", progress: 50 } });
    expect(validateProposal(raw, REQ).ok).toBe(false);
  });

  it("RED-68: a context id not in the supplied list is rejected", () => {
    const raw = base({
      title: { value: "Prepare interview", confidence: 0.9, rationale: null, ambiguity: null, sourceText: "Prepare interview" },
      contextId: { value: "ctx-unknown", confidence: 0.9, rationale: null, ambiguity: null, sourceText: "interview" },
    });
    const r = validateProposal(raw, REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SEMANTIC");
  });

  it("RED-119: a non-null deadline with a non-null baseUrgency is semantically invalid", () => {
    const raw = base({
      deadline: { value: { kind: "date", date: "2026-09-11", timeZone: "America/Chicago" }, confidence: 0.9, rationale: null, ambiguity: null, sourceText: "Friday" },
      baseUrgency: { value: 0.8, confidence: 0.9, rationale: null, ambiguity: null, sourceText: "3 hours" },
    });
    expect(validateProposal(raw, REQ).ok).toBe(false);
  });

  it("RED-124: an undated urgency proposal must cite a phrase from the input", () => {
    const ok = validateProposal(
      base({
        title: { value: "Fix pipe", confidence: 0.8, rationale: null, ambiguity: null, sourceText: "pipe" },
        baseUrgency: { value: 0.8, confidence: 0.99, rationale: "explicit", ambiguity: null, sourceText: "right now" },
      }),
      { input: "Fix the leaking pipe right now", contexts: [] },
    );
    expect(ok.ok).toBe(true);
    const bad = validateProposal(
      base({ baseUrgency: { value: 0.8, confidence: 0.99, rationale: "vibes", ambiguity: null, sourceText: null } }),
      { input: "Fix the pipe", contexts: [] },
    );
    expect(bad.ok).toBe(false);
  });

  it("confidence must be null iff value is null; non-null value needs sourceText", () => {
    expect(validateProposal(base({ title: { ...nf, value: "X", confidence: null } }), REQ).ok).toBe(false);
    expect(
      validateProposal(base({ title: { value: "X", confidence: 0.9, rationale: null, ambiguity: null, sourceText: null } }), REQ).ok,
    ).toBe(false);
  });

  it("sourceText must be a literal excerpt of the input", () => {
    const raw = base({
      title: { value: "Prepare interview", confidence: 0.9, rationale: null, ambiguity: null, sourceText: "not in the input" },
    });
    expect(validateProposal(raw, REQ).ok).toBe(false);
  });

  it("string that is not JSON is rejected, never evaluated", () => {
    expect(validateProposal("{ not json", REQ).ok).toBe(false);
  });
});
