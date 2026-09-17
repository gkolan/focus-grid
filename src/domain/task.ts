/**
 * Canonical domain model — contract sections 38–39. Pure data + validation.
 * No persistence, clock, or framework access here.
 */
import { z } from "zod";

// ── Enums ────────────────────────────────────────────────────────────────────
export type TaskStatus = "active" | "blocked" | "completed" | "archived";
export type ProgressSource = "binary" | "manual";
export type ValueSource = "default" | "user" | "ai" | "import";
export type Quadrant = "schedule" | "do_now" | "ignore" | "delegate";

// ── Limits and defaults (38.3, 41.2) ─────────────────────────────────────────
export const LIMITS = {
  titleMin: 1,
  titleMax: 200,
  notesMax: 10_000,
  captureMin: 1,
  captureMax: 4_000,
  estimateMin: 1,
  estimateMax: 525_600,
  contextNameMin: 1,
  contextNameMax: 40,
  contextMax: 50,
  taskCap: 10_000,
  gridMax: 250,
  importMaxBytes: 25 * 1024 * 1024,
  blockedReasonMax: 240,
} as const;

export const DEFAULT_BASE_IMPORTANCE = 0;
export const DEFAULT_BASE_URGENCY = -0.6;

/** Unicode code-point length (not UTF-16 length). */
export const codePoints = (s: string): number => [...s].length;

// ── Deadline (38.2, 40) ──────────────────────────────────────────────────────
export interface InstantDeadline {
  kind: "instant";
  at: string;
  timeZone: string;
}
export interface DateDeadline {
  kind: "date";
  date: string;
  timeZone: string;
}
export type Deadline = InstantDeadline | DateDeadline;

// ── Recurrence ─────────────────────────────────────────────────────────
export interface Recurrence {
  every: number; // 1..365
  unit: "day" | "week" | "month";
}
export const recurrenceSchema = z
  .object({ every: z.number().int().min(1).max(365), unit: z.enum(["day", "week", "month"]) })
  .strict();
export const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((t) => [...new Set(t.map((x) => x.normalize("NFC")))]);
export const assigneeSchema = z.string().trim().max(120).nullable();

// ── Work log (Focus events) ──────────────────────────────────────────────────
export type WorkEvent =
  | { kind: "session"; start: string; end: string | null } // end null = still running
  | { kind: "complete"; at: string }
  | { kind: "note"; at: string; note: string; session?: string }; // any number; `session` = start of the session it belongs to
export const WORK_NOTE_MAX = 1_000;

// ── Overrides & provenance ───────────────────────────────────────────────────
export interface AxisOverride {
  value: number; // [-1, 1], including 0
  setAt: string;
  source: "drag" | "editor";
}

export interface Provenance {
  source: ValueSource;
  changedAt: string;
  interpretationId: string | null;
}

export type ProvenanceField =
  | "title"
  | "notes"
  | "deadline"
  | "startAt"
  | "estimatedMinutes"
  | "contextId"
  | "baseImportance"
  | "baseUrgency";

export type TaskProvenance = Record<ProvenanceField, Provenance>;

// ── Task ─────────────────────────────────────────────────────────────────────
export interface Task {
  id: string;
  revision: number;
  title: string;
  notes: string;
  status: TaskStatus;
  progress: number;
  progressSource: ProgressSource;
  progressBeforeCompletion: number | null;
  deadline: Deadline | null;
  deadlineRevision: number;
  startAt: string | null;
  estimatedMinutes: number | null;
  timeSpentMinutes?: number; // accumulated by Focus start/pause; absent on older records = 0
  worklog?: WorkEvent[]; // Focus sessions, completions and notes, oldest first
  contextId: string | null;
  // Later fields — all optional so older records stay valid without a migration.
  recurrence?: Recurrence | null; // completing spawns the next occurrence
  parentId?: string | null; // subtask of a project task
  blockedByIds?: string[]; // dependencies: unfinished blockers keep it out of Focus
  assignee?: string | null; // delegated to someone else (name/email); excluded from Focus
  tags?: string[];
  baseImportance: number;
  baseUrgency: number;
  userImportanceOverride: AxisOverride | null;
  userUrgencyOverride: AxisOverride | null;
  importance: number;
  urgency: number;
  reviewAfter: string | null;
  archivedFrom: "active" | "blocked" | "completed" | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastUserEditedAt: string;
  completedAt: string | null;
  lastCalculatedAt: string;
  engineVersion: string;
}

export interface TaskRecord {
  task: Task;
  provenance: TaskProvenance;
}

// ── Context (38.4) ───────────────────────────────────────────────────────────
export interface Context {
  id: string;
  name: string;
  color: string; // #rrggbb
  seeded: boolean;
}

export const SEEDED_CONTEXT_NAMES = [
  "Work",
  "Family",
  "Home",
  "Personal",
  "Career",
  "Health",
  "Finance",
] as const;

// ── Zod primitives for external boundaries ───────────────────────────────────
const finite = z.number().refine(Number.isFinite, "must be a finite number");

export const unitInterval = finite.refine(
  (n) => n >= 0 && n <= 1,
  "must be within [0, 1]",
);
export const axisValue = finite.refine(
  (n) => n >= -1 && n <= 1,
  "must be within [-1, 1]",
);

export const titleSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => codePoints(s) >= LIMITS.titleMin, "title is required")
  .refine((s) => codePoints(s) <= LIMITS.titleMax, "title is too long (max 200)");

export const notesSchema = z
  .string()
  .refine(
    (s) => codePoints(s) <= LIMITS.notesMax,
    "notes are too long (max 10,000)",
  );

export const estimateSchema = z
  .number()
  .int("estimate must be a whole number of minutes")
  .refine(
    (n) => n >= LIMITS.estimateMin && n <= LIMITS.estimateMax,
    "estimate must be between 1 and 525,600 minutes",
  )
  .nullable();

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** A real calendar date in 1900–2200 with no impossible day/month (38.3). */
export function isRealCalendarDate(ymd: string): boolean {
  if (!YMD.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const deadlineSchema: z.ZodType<Deadline> = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("instant"),
      at: z.string().regex(ISO_Z, "instant must be a UTC ISO 8601 string"),
      timeZone: z.string(),
    }),
    z.object({
      kind: z.literal("date"),
      date: z.string(),
      timeZone: z.string(),
    }),
  ])
  .superRefine((v, ctx) => {
    if (!isValidTimeZone(v.timeZone)) {
      ctx.addIssue({ code: "custom", message: "unknown time zone", path: ["timeZone"] });
    }
    if (v.kind === "date" && !isRealCalendarDate(v.date)) {
      ctx.addIssue({ code: "custom", message: "impossible calendar date", path: ["date"] });
    }
    if (v.kind === "instant" && Number.isNaN(Date.parse(v.at))) {
      ctx.addIssue({ code: "custom", message: "invalid instant", path: ["at"] });
    }
  }) as z.ZodType<Deadline>;

export const startAtSchema = z
  .string()
  .regex(ISO_Z, "startAt must be a UTC ISO 8601 string")
  .nullable();

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a six-digit hex value");

/** NFC + case fold for context-name uniqueness (38.3). */
export const foldName = (s: string): string =>
  s.trim().normalize("NFC").toLocaleLowerCase();

/**
 * Strict external boundary schema for task field input (forms, import rows,
 * accepted AI proposals). Rejects unknown/prototype keys, NaN, infinity, numeric
 * strings, and out-of-range values rather than coercing them (38.3).
 */
export const externalTaskFieldsSchema = z
  .object({
    title: titleSchema,
    notes: notesSchema.optional(),
    deadline: deadlineSchema.nullable().optional(),
    startAt: startAtSchema.optional(),
    estimatedMinutes: estimateSchema.optional(),
    contextId: z
      .string()
      .regex(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        "contextId must be a UUID",
      )
      .nullable()
      .optional(),
    baseImportance: axisValue.optional(),
    baseUrgency: axisValue.optional(),
    progressSource: z.enum(["binary", "manual"]).optional(),
  })
  .strict();

export type ExternalTaskFields = z.infer<typeof externalTaskFieldsSchema>;

export const contextNameSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => codePoints(s) >= LIMITS.contextNameMin, "context name is required")
  .refine(
    (s) => codePoints(s) <= LIMITS.contextNameMax,
    "context name is too long (max 40)",
  );
