/**
 * AI capture wire contract — contract 43.1 / 43.6. Shared client + server (no
 * secrets). Strict: unknown keys rejected at every depth, no flattened shape.
 * The SAME validator runs on the server response boundary and again on the
 * local application boundary (43.3).
 */
import { z } from "zod";
import {
  LIMITS,
  codePoints,
  deadlineSchema,
  isRealCalendarDate,
  isValidTimeZone,
  type Deadline,
} from "@/domain/task";

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const cp = (min: number, max: number) => (s: string) => codePoints(s) >= min && codePoints(s) <= max;

// ── Request (43.1) ───────────────────────────────────────────────────────────
export const interpretRequestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    purpose: z.enum(["create", "suggest_updates"]),
    input: z
      .string()
      .transform((s) => s)
      .refine((s) => codePoints(s.trim()) >= LIMITS.captureMin, "capture text is required")
      .refine((s) => codePoints(s) <= LIMITS.captureMax, "capture text is too long (max 4,000)"),
    referenceNow: z.string().regex(ISO_Z, "referenceNow must be a UTC ISO 8601 string"),
    timeZone: z.string().refine(isValidTimeZone, "unknown time zone"),
    contexts: z
      .array(z.object({ id: z.string(), name: z.string() }).strict())
      .max(LIMITS.contextMax + 10),
  })
  .strict();

export type InterpretRequest = z.infer<typeof interpretRequestSchema>;

// ── Response (43.6) ──────────────────────────────────────────────────────────
interface RawField {
  value: unknown;
  confidence: number | null;
  rationale: string | null;
  ambiguity: string | null;
  sourceText: string | null;
}

function fieldCommonIssues(f: RawField, ctx: z.RefinementCtx): void {
  if ((f.value == null) !== (f.confidence == null)) {
    ctx.addIssue({ code: "custom", message: "confidence must be null iff value is null" });
  }
  for (const [k, v] of [
    ["rationale", f.rationale],
    ["ambiguity", f.ambiguity],
  ] as const) {
    if (v != null && !cp(1, 240)(v.trim())) {
      ctx.addIssue({ code: "custom", message: `${k} must be 1-240 code points`, path: [k] });
    }
  }
  if (f.sourceText != null && !cp(1, 500)(f.sourceText)) {
    ctx.addIssue({ code: "custom", message: "sourceText must be 1-500 code points", path: ["sourceText"] });
  }
  if (f.value != null && f.sourceText == null) {
    ctx.addIssue({ code: "custom", message: "a proposed value requires a sourceText excerpt" });
  }
}

function proposedField<T extends z.ZodTypeAny>(value: T) {
  return z
    .object({
      value: z.union([value, z.null()]),
      confidence: z.number().finite().min(0).max(1).nullable(),
      rationale: z.string().nullable(),
      ambiguity: z.string().nullable(),
      sourceText: z.string().nullable(),
    })
    .strict()
    .superRefine((f, ctx) => fieldCommonIssues(f as RawField, ctx));
}

const axis = z.number().finite().min(-1).max(1);

export const interpretResponseSchema = z
  .object({
    schemaVersion: z.literal("1"),
    fields: z
      .object({
        title: proposedField(z.string().min(1).max(2000)),
        notes: proposedField(z.string().max(20_000)),
        deadline: proposedField(deadlineSchema),
        startAt: proposedField(z.string().regex(ISO_Z)),
        estimatedMinutes: proposedField(z.number().int().min(1).max(525_600)),
        contextId: proposedField(z.string()),
        baseImportance: proposedField(axis),
        baseUrgency: proposedField(axis),
      })
      .strict(),
  })
  .strict();

export type InterpretResponse = z.infer<typeof interpretResponseSchema>;

export interface ValidationFailure {
  code: "SCHEMA" | "SEMANTIC";
  message: string;
}

/**
 * JSON-schema validation followed by section-43.6 semantic validation:
 * calendar sanity, context references, urgency applicability (RED-68/69/119).
 */
export function validateProposal(
  raw: unknown,
  request: Pick<InterpretRequest, "input" | "contexts">,
): { ok: true; response: InterpretResponse } | { ok: false; error: ValidationFailure } {
  if (typeof raw === "string") {
    // must be JSON data, never JS evaluated
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, error: { code: "SCHEMA", message: "response was not valid JSON" } };
    }
  }
  const parsed = interpretResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "SCHEMA", message: parsed.error.issues[0]?.message ?? "invalid response shape" } };
  }
  const r = parsed.data;
  const f = r.fields;

  // context reference must exist in the supplied list (RED-68)
  if (f.contextId.value != null && !request.contexts.some((c) => c.id === f.contextId.value)) {
    return { ok: false, error: { code: "SEMANTIC", message: "proposed context is not one of the supplied contexts" } };
  }
  // calendar sanity for a date-only deadline
  const d = f.deadline.value as Deadline | null;
  if (d?.kind === "date" && !isRealCalendarDate(d.date)) {
    return { ok: false, error: { code: "SEMANTIC", message: "proposed deadline is not a real calendar date" } };
  }
  // RED-119: a dated proposal cannot carry a non-null baseUrgency
  if (f.deadline.value != null && f.baseUrgency.value != null) {
    return { ok: false, error: { code: "SEMANTIC", message: "a dated task cannot also propose an urgency value" } };
  }
  // baseUrgency, when proposed, must be grounded in an explicit phrase (43.6)
  if (f.baseUrgency.value != null && (f.baseUrgency.sourceText == null || f.baseUrgency.sourceText.trim() === "")) {
    return { ok: false, error: { code: "SEMANTIC", message: "an urgency proposal must cite the phrase that expresses time pressure" } };
  }
  // sourceText must be a literal excerpt of the input where present
  for (const key of Object.keys(f) as (keyof typeof f)[]) {
    const st = f[key].sourceText;
    if (st != null && !request.input.includes(st)) {
      return { ok: false, error: { code: "SEMANTIC", message: `sourceText for ${key} is not a literal excerpt of the input` } };
    }
  }
  return { ok: true, response: r };
}

export const MAX_RESPONSE_BYTES = 32 * 1024;
export const MAX_REQUEST_BYTES = 64 * 1024;
