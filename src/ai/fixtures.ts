/**
 * Deterministic fixture interpretations — contract 43.7. Routed through the SAME
 * strict validator and application path as real responses. Clearly labeled as a
 * demo; never advertised as a live model.
 */
import type { InterpretRequest } from "./schema";

export type FixtureOutcome =
  | { kind: "response"; raw: unknown }
  | { kind: "http"; status: number; code: string };

const nullField = { value: null, confidence: null, rationale: null, ambiguity: null, sourceText: null };

export function fixtureFor(req: InterpretRequest): FixtureOutcome {
  const input = req.input.trim();
  const lc = input.toLowerCase();

  // ── failure fixtures (keyword-triggered) ──────────────────────────────────
  if (lc.includes("fixture:timeout")) return { kind: "http", status: 504, code: "AI_TIMEOUT" };
  if (lc.includes("fixture:ratelimit")) return { kind: "http", status: 429, code: "AI_UNAVAILABLE" };
  if (lc.includes("fixture:badjson")) return { kind: "response", raw: "{ not json" };
  if (lc.includes("fixture:unsafe")) {
    return {
      kind: "response",
      raw: {
        schemaVersion: "1",
        fields: {
          title: { ...nullField, value: "x", confidence: 0.9, sourceText: "x", progress: 50 },
        },
      },
    };
  }
  if (lc.includes("fixture:context")) {
    return {
      kind: "response",
      raw: base({ contextId: { value: "ctx-does-not-exist", confidence: 0.9, rationale: "guess", ambiguity: null, sourceText: input.slice(0, 5) } }),
    };
  }
  if (lc.includes("fixture:dated-urgent")) {
    // semantically invalid: deadline + baseUrgency both set (RED-119)
    return {
      kind: "response",
      raw: base({
        deadline: { value: { kind: "date", date: "2026-09-11", timeZone: req.timeZone }, confidence: 0.9, rationale: "Friday", ambiguity: null, sourceText: "Friday" },
        baseUrgency: { value: 0.8, confidence: 0.9, rationale: "urgent", ambiguity: null, sourceText: "urgent" },
      }),
    };
  }

  // ── canonical valid: "Prepare interview Friday for 3 hours." ───────────────
  if (/prepare interview/.test(lc) && /friday/.test(lc) && /(3|three) hours?/.test(lc)) {
    return {
      kind: "response",
      raw: base({
        title: { value: "Prepare interview", confidence: 0.95, rationale: "The input names interview preparation.", ambiguity: null, sourceText: "Prepare interview" },
        deadline: { value: { kind: "date", date: "2026-09-11", timeZone: "America/Chicago" }, confidence: 0.95, rationale: "Friday resolves from the supplied reference date.", ambiguity: null, sourceText: "Friday" },
        estimatedMinutes: { value: 180, confidence: 0.95, rationale: "Three hours is 180 minutes.", ambiguity: null, sourceText: "3 hours" },
      }),
    };
  }

  // ── undated explicit urgency (acceptance required) ────────────────────────
  if (/(right now|handle .* now|urgent)/.test(lc) && !/friday|monday|tomorrow|today/.test(lc)) {
    const phrase = input.match(/right now|now/i)?.[0] ?? "now";
    return {
      kind: "response",
      raw: base({
        title: { value: capitalize(input.replace(/\s+right now\.?$/i, "").trim()) || "Handle it", confidence: 0.8, rationale: "Restates the task text.", ambiguity: null, sourceText: input.slice(0, 60) },
        baseUrgency: { value: 0.8, confidence: 0.8, rationale: "The phrase expresses immediate time pressure.", ambiguity: null, sourceText: phrase },
      }),
    };
  }

  // ── ambiguous numeric date ───────────────────────────────────────────────
  const numDate = input.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (numDate) {
    return {
      kind: "response",
      raw: base({
        title: { value: capitalize(input.replace(numDate[0], "").trim()) || "Task", confidence: 0.7, rationale: "Restates the task text.", ambiguity: null, sourceText: input.slice(0, 40) },
        deadline: { value: null, confidence: null, rationale: null, ambiguity: `“${numDate[0]}” could be month/day or day/month — please confirm the date.`, sourceText: numDate[0] },
      }),
    };
  }

  // ── "clean garage soon" / vague → all-null except title ───────────────────
  return {
    kind: "response",
    raw: base({
      title: { value: capitalize(stripVague(input)) || input.slice(0, 200), confidence: 0.75, rationale: "Uses the capture text as the title.", ambiguity: null, sourceText: input.slice(0, 60) },
    }),
  };
}

function base(overrides: Record<string, unknown>): unknown {
  const fields: Record<string, unknown> = {
    title: nullField,
    notes: nullField,
    deadline: nullField,
    startAt: nullField,
    estimatedMinutes: nullField,
    contextId: nullField,
    baseImportance: nullField,
    baseUrgency: nullField,
    ...overrides,
  };
  return { schemaVersion: "1", fields };
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function stripVague(s: string): string {
  return s.replace(/\b(soon|sometime|later|someday)\b/gi, "").replace(/\s+/g, " ").trim();
}
