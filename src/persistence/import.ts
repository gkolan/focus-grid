/**
 * Import validation + Add-as-copies — contract 46.3 / 46.5. JSON is parsed as
 * data (never eval). One invalid record rejects the whole file; the live store
 * is never touched until a single atomic transaction commits.
 */
import { z } from "zod";
import { type Result, err, ok } from "@/domain/errors";
import {
  LIMITS,
  WORK_NOTE_MAX,
  axisValue,
  deadlineSchema,
  foldName,
  hexColorSchema,
  isRealCalendarDate,
  unitInterval,
} from "@/domain/task";
import { EXPORT_SCHEMA_VERSION, type ExportEnvelope } from "./export";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function hasForbiddenKey(v: unknown, depth = 0): boolean {
  if (depth > 40 || v == null || typeof v !== "object") return false;
  if (Array.isArray(v)) return v.some((x) => hasForbiddenKey(x, depth + 1));
  for (const k of Object.keys(v)) {
    if (FORBIDDEN_KEYS.has(k)) return true;
    if (hasForbiddenKey((v as Record<string, unknown>)[k], depth + 1)) return true;
  }
  return false;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const uuidish = z.string().min(1).max(200);

const importTaskSchema = z
  .object({
    id: uuidish,
    revision: z.number().int().min(1),
    title: z.string().min(1).max(200),
    notes: z.string().max(LIMITS.notesMax),
    status: z.enum(["active", "blocked", "completed", "archived"]),
    progress: unitInterval,
    progressSource: z.enum(["binary", "manual"]),
    progressBeforeCompletion: unitInterval.nullable(),
    deadline: deadlineSchema.nullable(),
    deadlineRevision: z.number().int().min(1),
    startAt: z.string().regex(ISO_Z).nullable(),
    estimatedMinutes: z.number().int().min(1).max(525_600).nullable(),
    timeSpentMinutes: z.number().min(0).optional(),
    worklog: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("session"), start: z.string().regex(ISO_Z), end: z.string().regex(ISO_Z).nullable() }).strict(),
          z.object({ kind: z.literal("complete"), at: z.string().regex(ISO_Z) }).strict(),
          z.object({ kind: z.literal("note"), at: z.string().regex(ISO_Z), note: z.string().min(1).max(WORK_NOTE_MAX), session: z.string().regex(ISO_Z).optional() }).strict(),
        ]),
      )
      .optional(),
    contextId: z.string().nullable(),
    baseImportance: axisValue,
    baseUrgency: axisValue,
    userImportanceOverride: z
      .object({ value: axisValue, setAt: z.string(), source: z.enum(["drag", "editor"]) })
      .nullable(),
    userUrgencyOverride: z
      .object({ value: axisValue, setAt: z.string(), source: z.enum(["drag", "editor"]) })
      .nullable(),
    importance: axisValue,
    urgency: axisValue,
    reviewAfter: z.string().nullable(),
    archivedFrom: z.enum(["active", "blocked", "completed"]).nullable(),
    blockedReason: z.string().max(240).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastUserEditedAt: z.string(),
    completedAt: z.string().nullable(),
    lastCalculatedAt: z.string(),
    engineVersion: z.string(),
  })
  .passthrough(); // extra descriptive fields tolerated, but forbidden keys checked separately

const importContextSchema = z
  .object({ id: uuidish, name: z.string().min(1).max(40), color: hexColorSchema, seeded: z.boolean() })
  .strict();

const envelopeSchema = z
  .object({
    format: z.literal("focusgrid-export"),
    schemaVersion: z.number().int(),
    exportedAt: z.string(),
    tasks: z.array(z.unknown()),
    provenance: z.array(z.unknown()),
    contexts: z.array(z.unknown()),
    history: z.array(z.unknown()),
    interpretations: z.array(z.unknown()),
    settings: z.unknown().optional(),
  })
  .passthrough();

export interface ParsedImport {
  envelope: ExportEnvelope;
  taskCount: number;
  contextCount: number;
  historyCount: number;
  warnings: string[];
}

export function validateImportFile(text: string): Result<ParsedImport> {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return err("VALIDATION", "Backup file is larger than 25 MiB.");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("VALIDATION", "That file is not valid JSON.");
  }
  if (hasForbiddenKey(json)) {
    return err("VALIDATION", "The file contains disallowed keys (__proto__ / prototype / constructor).");
  }
  const env = envelopeSchema.safeParse(json);
  if (!env.success) {
    return err("VALIDATION", "This is not a FocusGrid backup file.");
  }
  if (env.data.schemaVersion > EXPORT_SCHEMA_VERSION) {
    return err("SCHEMA_UNSUPPORTED", "This backup is from a newer version of FocusGrid.");
  }

  // per-record validation — one bad row rejects the whole file
  const taskIds = new Set<string>();
  const tasks: z.infer<typeof importTaskSchema>[] = [];
  for (const [i, rawTask] of env.data.tasks.entries()) {
    const t = importTaskSchema.safeParse(rawTask);
    if (!t.success) return err("VALIDATION", `Task row ${i + 1} is invalid: ${t.error.issues[0]?.message}`);
    if (taskIds.has(t.data.id)) return err("VALIDATION", `Duplicate task id "${t.data.id}".`);
    if (t.data.deadline?.kind === "date" && !isRealCalendarDate(t.data.deadline.date)) {
      return err("VALIDATION", `Task row ${i + 1} has an impossible date.`);
    }
    if (t.data.status === "archived" && t.data.archivedFrom == null) {
      return err("VALIDATION", `Task row ${i + 1}: archived task is missing its prior status.`);
    }
    taskIds.add(t.data.id);
    tasks.push(t.data);
  }

  const contextIds = new Set<string>();
  const contexts: z.infer<typeof importContextSchema>[] = [];
  for (const [i, rawCtx] of env.data.contexts.entries()) {
    const c = importContextSchema.safeParse(rawCtx);
    if (!c.success) return err("VALIDATION", `Context row ${i + 1} is invalid.`);
    if (contextIds.has(c.data.id)) return err("VALIDATION", `Duplicate context id "${c.data.id}".`);
    contextIds.add(c.data.id);
    contexts.push(c.data);
  }

  // dangling references
  for (const t of tasks) {
    if (t.contextId != null && !contextIds.has(t.contextId)) {
      return err("VALIDATION", `Task "${t.title}" points at a context that is not in the file.`);
    }
  }
  for (const [i, p] of env.data.provenance.entries()) {
    const taskId = (p as { taskId?: unknown })?.taskId;
    if (typeof taskId !== "string" || !taskIds.has(taskId)) {
      return err("VALIDATION", `Provenance row ${i + 1} points at a missing task.`);
    }
  }
  for (const [i, h] of env.data.history.entries()) {
    const taskId = (h as { taskId?: unknown })?.taskId;
    if (typeof taskId !== "string" || !taskIds.has(taskId)) {
      return err("VALIDATION", `History row ${i + 1} points at a missing task.`);
    }
  }

  const warnings: string[] = [];
  if (env.data.settings != null) {
    warnings.push("The file's settings are ignored — Add as copies keeps your current settings.");
  }
  if (env.data.interpretations.length) {
    warnings.push("AI interpretation metadata is imported for reference only.");
  }

  return ok({
    envelope: env.data as unknown as ExportEnvelope,
    taskCount: tasks.length,
    contextCount: contexts.length,
    historyCount: env.data.history.length,
    warnings,
  });
}

/** Map a context id from the file to an existing local context by folded name. */
export function matchContextByName(
  name: string,
  existing: { id: string; name: string }[],
): string | null {
  const folded = foldName(name);
  return existing.find((c) => foldName(c.name) === folded)?.id ?? null;
}
