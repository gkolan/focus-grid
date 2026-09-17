import { describe, expect, it } from "vitest";
import { fixtureFor } from "./fixtures";
import { validateProposal } from "./schema";

const req = (input: string) => ({
  schemaVersion: "1" as const,
  purpose: "create" as const,
  input,
  referenceNow: "2026-09-09T14:00:00.000Z",
  timeZone: "America/Chicago",
  contexts: [{ id: "ctx-work", name: "Work" }],
});

describe("fixture adapter (43.7)", () => {
  it("canonical dated fixture validates and has urgency null", () => {
    const r = req("Prepare interview Friday for 3 hours.");
    const out = fixtureFor(r);
    expect(out.kind).toBe("response");
    if (out.kind !== "response") return;
    const v = validateProposal(out.raw, r);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.response.fields.baseUrgency.value).toBeNull();
      expect(v.response.fields.estimatedMinutes.value).toBe(180);
    }
  });

  it("undated urgent fixture validates with a grounded baseUrgency", () => {
    const r = req("Handle the leaking pipe right now");
    const out = fixtureFor(r);
    if (out.kind !== "response") throw new Error();
    const v = validateProposal(out.raw, r);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.response.fields.baseUrgency.value).toBe(0.8);
      expect(v.response.fields.deadline.value).toBeNull();
    }
  });

  it("all-null-ish fixture (vague input) validates", () => {
    const r = req("clean garage soon");
    const out = fixtureFor(r);
    if (out.kind !== "response") throw new Error();
    expect(validateProposal(out.raw, r).ok).toBe(true);
  });

  it("ambiguous numeric-date fixture validates and does not set a deadline value", () => {
    const r = req("Submit form 04/05");
    const out = fixtureFor(r);
    if (out.kind !== "response") throw new Error();
    const v = validateProposal(out.raw, r);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.response.fields.deadline.value).toBeNull();
      expect(v.response.fields.deadline.ambiguity).toBeTruthy();
    }
  });

  it("invalid fixtures are intentionally rejected, not normalised", () => {
    expect(fixtureFor(req("fixture:timeout")).kind).toBe("http");
    const unsafe = fixtureFor(req("fixture:unsafe"));
    expect(unsafe.kind).toBe("response");
    if (unsafe.kind === "response") expect(validateProposal(unsafe.raw, req("fixture:unsafe")).ok).toBe(false);
    const ctx = fixtureFor(req("fixture:context"));
    if (ctx.kind === "response") expect(validateProposal(ctx.raw, req("fixture:context")).ok).toBe(false);
    const du = fixtureFor(req("fixture:dated-urgent"));
    if (du.kind === "response") expect(validateProposal(du.raw, req("fixture:dated-urgent")).ok).toBe(false);
  });
});
