/**
 * Pure task commands — contract 39.1–39.3. No persistence, network, clock, or
 * randomness: callers inject `now` and preallocated ids. Every command returns a
 * typed Result and, on success, the new TaskRecord plus history reason codes.
 * A failed command has no partial effect.
 */
import {
  type AxisOverride,
  type Context,
  type Deadline,
  DEFAULT_BASE_IMPORTANCE,
  DEFAULT_BASE_URGENCY,
  type ProgressSource,
  type Provenance,
  type ProvenanceField,
  type Recurrence,
  type TaskProvenance,
  type TaskRecord,
  type Task,
  type WorkEvent,
  WORK_NOTE_MAX,
  type ValueSource,
  LIMITS,
  axisValue,
  codePoints,
  deadlineSchema,
  estimateSchema,
  foldName,
  notesSchema,
  startAtSchema,
  titleSchema,
  recurrenceSchema,
  tagsSchema,
  assigneeSchema,
} from "./task";
import { type Result, err, ok } from "./errors";

export type EventReason =
  | "created"
  | "blocked"
  | "unblocked"
  | "completed"
  | "reopened"
  | "archived"
  | "restored"
  | "progress_changed"
  | "override_set"
  | "override_reset"
  | "deadline_changed"
  | "edited";

export interface Mutation {
  record: TaskRecord;
  events: EventReason[];
}

const iso = (now: Date): string => now.toISOString();

function prov(source: ValueSource, at: string, interpretationId: string | null = null): Provenance {
  return { source, changedAt: at, interpretationId };
}

function bump(task: Task, now: Date): Task {
  return { ...task, revision: task.revision + 1, updatedAt: iso(now) };
}

// ── Create ───────────────────────────────────────────────────────────────────
export interface CreateInput {
  id: string;
  title: string;
  notes?: string;
  deadline?: Deadline | null;
  startAt?: string | null;
  estimatedMinutes?: number | null;
  contextId?: string | null;
  baseImportance?: number;
  baseUrgency?: number;
  progressSource?: ProgressSource;
  recurrence?: Recurrence | null;
  parentId?: string | null;
  blockedByIds?: string[];
  assignee?: string | null;
  tags?: string[];
  /** provenance for the fields supplied in this call */
  source?: Exclude<ValueSource, "default">;
  interpretationId?: string | null;
}

export function createTask(
  input: CreateInput,
  now: Date,
  knownContextIds: ReadonlySet<string>,
): Result<Mutation> {
  const at = iso(now);
  const src: ValueSource = input.source ?? "user";

  const title = titleSchema.safeParse(input.title);
  if (!title.success) return err("VALIDATION", title.error.issues[0].message, "title");

  const notes = notesSchema.safeParse(input.notes ?? "");
  if (!notes.success) return err("VALIDATION", notes.error.issues[0].message, "notes");

  let deadline: Deadline | null = null;
  if (input.deadline != null) {
    const d = deadlineSchema.safeParse(input.deadline);
    if (!d.success) return err("VALIDATION", d.error.issues[0].message, "deadline");
    deadline = d.data;
  }

  let startAt: string | null = null;
  if (input.startAt != null) {
    const s = startAtSchema.safeParse(input.startAt);
    if (!s.success) return err("VALIDATION", s.error.issues[0].message, "startAt");
    startAt = s.data;
  }

  let estimatedMinutes: number | null = null;
  if (input.estimatedMinutes != null) {
    const e = estimateSchema.safeParse(input.estimatedMinutes);
    if (!e.success) return err("VALIDATION", e.error.issues[0].message, "estimatedMinutes");
    estimatedMinutes = e.data;
  }

  if (input.contextId != null && !knownContextIds.has(input.contextId)) {
    return err("VALIDATION", "unknown context", "contextId");
  }

  const baseImportance = input.baseImportance ?? DEFAULT_BASE_IMPORTANCE;
  if (!axisValue.safeParse(baseImportance).success) {
    return err("VALIDATION", "baseImportance must be within [-1, 1]", "baseImportance");
  }
  const baseUrgency = input.baseUrgency ?? DEFAULT_BASE_URGENCY;
  if (!axisValue.safeParse(baseUrgency).success) {
    return err("VALIDATION", "baseUrgency must be within [-1, 1]", "baseUrgency");
  }
  // 43.6: a dated task cannot carry a proposed baseUrgency.
  if (deadline != null && input.baseUrgency != null && src === "ai") {
    return err("VALIDATION", "a dated task cannot have an AI urgency proposal", "baseUrgency");
  }
  if (startAt != null && deadline != null) {
    const cutoff = instantOfDeadline(deadline);
    if (cutoff != null && Date.parse(startAt) > cutoff) {
      return err("VALIDATION", "start time is after the deadline", "startAt");
    }
  }

  const extras = validateExtras(input, input.id);
  if (!extras.ok) return extras;

  const has = (f: keyof CreateInput) => input[f] !== undefined && input[f] !== null;
  const fieldSource = (f: keyof CreateInput): ValueSource => (has(f) ? src : "default");
  const ip = input.interpretationId ?? null;

  const task: Task = {
    id: input.id,
    revision: 1,
    title: title.data,
    notes: notes.data,
    status: "active",
    progress: 0,
    progressSource: input.progressSource ?? "binary",
    progressBeforeCompletion: null,
    deadline,
    deadlineRevision: 1,
    startAt,
    estimatedMinutes,
    contextId: input.contextId ?? null,
    baseImportance,
    baseUrgency,
    userImportanceOverride: null,
    userUrgencyOverride: null,
    importance: baseImportance,
    urgency: baseUrgency,
    reviewAfter: null,
    archivedFrom: null,
    blockedReason: null,
    createdAt: at,
    updatedAt: at,
    lastUserEditedAt: at,
    completedAt: null,
    lastCalculatedAt: at,
    engineVersion: "1.0",
    ...extras.value,
  };

  const provenance: TaskProvenance = {
    title: prov(has("title") ? src : "default", at, ip),
    notes: prov(fieldSource("notes"), at, ip),
    deadline: prov(fieldSource("deadline"), at, ip),
    startAt: prov(fieldSource("startAt"), at, ip),
    estimatedMinutes: prov(fieldSource("estimatedMinutes"), at, ip),
    contextId: prov(fieldSource("contextId"), at, ip),
    baseImportance: prov(fieldSource("baseImportance"), at, ip),
    baseUrgency: prov(fieldSource("baseUrgency"), at, ip),
  };

  return ok({ record: { task, provenance }, events: ["created"] });
}

type Extras = Pick<Task, "recurrence" | "parentId" | "blockedByIds" | "assignee" | "tags">;

/** True when following `next` from `start` comes back to `self` (parent chains, blocker graphs). */
export function reaches(start: string, self: string, next: (id: string) => string[], limit = 1000): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length && seen.size < limit) {
    const id = stack.pop()!;
    if (id === self) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return false;
}

/** Validate the optional fields shared by create and patch. */
function validateExtras(input: Partial<Extras>, self?: string): Result<Extras> {
  const out: Extras = {};
  if (input.recurrence !== undefined) {
    if (input.recurrence === null) out.recurrence = null;
    else {
      const r = recurrenceSchema.safeParse(input.recurrence);
      if (!r.success) return err("VALIDATION", "recurrence must be every 1–365 days, weeks or months", "recurrence");
      out.recurrence = r.data;
    }
  }
  if (input.parentId !== undefined) {
    if (input.parentId != null && input.parentId === self) return err("VALIDATION", "a task cannot be its own parent", "parentId");
    out.parentId = input.parentId ?? null;
  }
  if (input.blockedByIds !== undefined) {
    const ids = [...new Set(input.blockedByIds ?? [])].filter((id) => id !== self);
    if (ids.length > 50) return err("VALIDATION", "at most 50 blockers", "blockedByIds");
    out.blockedByIds = ids;
  }
  if (input.assignee !== undefined) {
    const a = assigneeSchema.safeParse(input.assignee);
    if (!a.success) return err("VALIDATION", "assignee is too long (max 120)", "assignee");
    out.assignee = a.data || null;
  }
  if (input.tags !== undefined) {
    const t = tagsSchema.safeParse(input.tags ?? []);
    if (!t.success) return err("VALIDATION", "tags: up to 20, each 1–40 characters", "tags");
    out.tags = t.data;
  }
  return ok(out);
}

/** UTC epoch ms of a deadline's cutoff, or null for date-only (needs tz math, step 02). */
function instantOfDeadline(d: Deadline): number | null {
  return d.kind === "instant" ? Date.parse(d.at) : null;
}

// ── Lifecycle (39.1) ─────────────────────────────────────────────────────────
export function block(r: TaskRecord, now: Date, reason?: string | null): Result<Mutation> {
  if (r.task.status === "archived") return err("CONFLICT", "restore the task before editing it");
  if (r.task.status !== "active") return err("CONFLICT", "only active tasks can be blocked");
  if (reason != null && codePoints(reason) > LIMITS.blockedReasonMax) {
    return err("VALIDATION", "blocked reason is too long", "blockedReason");
  }
  const task = { ...bump(r.task, now), status: "blocked" as const, blockedReason: reason ?? null };
  return ok({ record: { ...r, task }, events: ["blocked"] });
}

export function unblock(r: TaskRecord, now: Date): Result<Mutation> {
  if (r.task.status !== "blocked") return err("CONFLICT", "task is not blocked");
  const task = { ...bump(r.task, now), status: "active" as const, blockedReason: null };
  return ok({ record: { ...r, task }, events: ["unblocked"] });
}

export function complete(r: TaskRecord, now: Date): Result<Mutation> {
  if (r.task.status === "completed") return ok({ record: r, events: [] }); // idempotent no-op
  if (r.task.status === "archived") return err("CONFLICT", "restore the task before completing it");
  if (r.task.status !== "active" && r.task.status !== "blocked") {
    return err("CONFLICT", "task cannot be completed from its current state");
  }
  const task: Task = {
    ...bump(r.task, now),
    status: "completed",
    progressBeforeCompletion: r.task.progress < 1 ? r.task.progress : r.task.progressBeforeCompletion,
    progress: 1,
    completedAt: iso(now),
    blockedReason: null,
    worklog: [...(r.task.worklog ?? []), { kind: "complete", at: iso(now) }],
  };
  return ok({ record: { ...r, task }, events: ["completed"] });
}

export function reopen(r: TaskRecord, now: Date): Result<Mutation> {
  if (r.task.status !== "completed") return err("CONFLICT", "only completed tasks can be reopened");
  const restored = r.task.progressBeforeCompletion;
  const task: Task = {
    ...bump(r.task, now),
    status: "active",
    progress: restored != null && restored < 1 ? restored : 0,
    progressBeforeCompletion: null,
    completedAt: null,
  };
  return ok({ record: { ...r, task }, events: ["reopened"] });
}

export function archive(r: TaskRecord, now: Date): Result<Mutation> {
  if (r.task.status === "archived") return ok({ record: r, events: [] }); // idempotent
  const from = r.task.status;
  const task: Task = { ...bump(r.task, now), status: "archived", archivedFrom: from };
  return ok({ record: { ...r, task }, events: ["archived"] });
}

export function restore(r: TaskRecord, now: Date): Result<Mutation> {
  if (r.task.status !== "archived") return err("CONFLICT", "task is not archived");
  const to = r.task.archivedFrom ?? "active";
  const task: Task = { ...bump(r.task, now), status: to, archivedFrom: null };
  return ok({ record: { ...r, task }, events: ["restored"] });
}

/**
 * "Still relevant" — postpone the next stale-overdue review by 7 elapsed days
 * (41.7). No deadline / importance / urgency change.
 */
export function markStillRelevant(r: TaskRecord, now: Date): Result<Mutation> {
  if (r.task.status !== "active" && r.task.status !== "blocked") {
    return err("CONFLICT", "only active or blocked tasks can be marked still relevant");
  }
  const task: Task = {
    ...bump(r.task, now),
    lastUserEditedAt: iso(now),
    reviewAfter: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
  };
  return ok({ record: { ...r, task }, events: ["edited"] });
}

/** Validate a permanent-delete intent (39.1). Actual removal is transactional (step 03). */
export function deleteIntent(r: TaskRecord): Result<{ id: string }> {
  return ok({ id: r.task.id });
}

// ── Progress (39.2) ──────────────────────────────────────────────────────────
export function setManualProgress(r: TaskRecord, percent: number, now: Date): Result<Mutation> {
  if (r.task.status === "archived") return err("CONFLICT", "restore the task first");
  if (r.task.status === "completed") {
    return err("CONFLICT", "reopen the task before lowering its progress");
  }
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return err("VALIDATION", "progress must be a whole percent from 0 to 100", "progress");
  }
  if (percent === 100) {
    const done = complete({ ...r, task: { ...r.task, progressSource: "manual" } }, now);
    return done;
  }
  const task: Task = {
    ...bump(r.task, now),
    progress: percent / 100,
    progressSource: "manual",
    lastUserEditedAt: iso(now),
  };
  return ok({ record: { ...r, task }, events: ["progress_changed"] });
}

/** Switching an incomplete manual task to binary resets progress to 0 — caller must confirm. */
export function setProgressSource(
  r: TaskRecord,
  source: ProgressSource,
  now: Date,
  confirmReset = false,
): Result<Mutation> {
  if (r.task.status === "archived") return err("CONFLICT", "restore the task first");
  if (source === r.task.progressSource) return ok({ record: r, events: [] });
  const willReset = source === "binary" && r.task.progress > 0 && r.task.progress < 1;
  if (willReset && !confirmReset) {
    return err("VALIDATION", "switching to binary will reset progress to 0", "progressSource");
  }
  const task: Task = {
    ...bump(r.task, now),
    progressSource: source,
    progress: willReset ? 0 : r.task.progress,
    lastUserEditedAt: iso(now),
  };
  return ok({ record: { ...r, task }, events: ["progress_changed"] });
}

// ── Overrides (39.3) ─────────────────────────────────────────────────────────
export function setAxisOverride(
  r: TaskRecord,
  axis: "importance" | "urgency",
  value: number,
  source: "drag" | "editor",
  now: Date,
): Result<Mutation> {
  if (r.task.status === "archived") return err("CONFLICT", "restore the task first");
  if (!axisValue.safeParse(value).success) {
    return err("VALIDATION", "override must be within [-1, 1]", axis);
  }
  const ov: AxisOverride = { value, setAt: iso(now), source };
  const task: Task = {
    ...bump(r.task, now),
    lastUserEditedAt: iso(now),
    ...(axis === "importance"
      ? { userImportanceOverride: ov, importance: value }
      : { userUrgencyOverride: ov, urgency: value }),
  };
  return ok({ record: { ...r, task }, events: ["override_set"] });
}

/**
 * A drag that ends in a different position writes BOTH axis overrides using the
 * inverse viewport transform (39.3). One command, one revision bump.
 */
export function setDragOverride(
  r: TaskRecord,
  coord: { urgency: number; importance: number },
  now: Date,
): Result<Mutation> {
  if (r.task.status === "archived") return err("CONFLICT", "restore the task first");
  if (!axisValue.safeParse(coord.urgency).success || !axisValue.safeParse(coord.importance).success) {
    return err("VALIDATION", "drag position out of range");
  }
  const at = iso(now);
  const task: Task = {
    ...bump(r.task, now),
    lastUserEditedAt: at,
    userImportanceOverride: { value: coord.importance, setAt: at, source: "drag" },
    userUrgencyOverride: { value: coord.urgency, setAt: at, source: "drag" },
    importance: coord.importance,
    urgency: coord.urgency,
  };
  return ok({ record: { ...r, task }, events: ["override_set"] });
}

// ── Work log ─────────────────────────────────────────────────────────────────
function withLog(r: TaskRecord, worklog: WorkEvent[], now: Date, userEdit = false): Result<Mutation> {
  const task: Task = { ...bump(r.task, now), worklog, ...(userEdit ? { lastUserEditedAt: iso(now) } : {}) };
  return ok({ record: { ...r, task }, events: ["edited"] });
}
function checkNote(note: string): Result<string> {
  const t = note.trim();
  return codePoints(t) > WORK_NOTE_MAX ? err("VALIDATION", `note is longer than ${WORK_NOTE_MAX} characters`) : ok(t);
}

/** Focus Start — open a session. */
export function startWorkSession(r: TaskRecord, now: Date): Result<Mutation> {
  return withLog(r, [...(r.task.worklog ?? []), { kind: "session", start: iso(now), end: null }], now);
}
/** Focus Pause — close the open session and bank the elapsed minutes. */
export function stopWorkSession(r: TaskRecord, minutes: number, now: Date): Result<Mutation> {
  const log = r.task.worklog ?? [];
  const i = log.findLastIndex((e) => e.kind === "session" && e.end == null);
  const closed = i < 0 ? log : log.with(i, { ...log[i]!, end: iso(now) } as WorkEvent);
  const task: Task = { ...bump(r.task, now), worklog: closed, timeSpentMinutes: (r.task.timeSpentMinutes ?? 0) + Math.max(0, minutes) };
  return ok({ record: { ...r, task }, events: ["edited"] });
}
/** Add a note. Links to `session` (a session's start) when given, else to the running session if any. */
export function addWorkNote(r: TaskRecord, note: string, now: Date, session?: string): Result<Mutation> {
  const c = checkNote(note);
  if (!c.ok) return c;
  if (!c.value) return err("VALIDATION", "note is empty");
  const log = r.task.worklog ?? [];
  const sessions = log.filter((e) => e.kind === "session");
  const link = session ?? sessions.find((s) => s.end == null)?.start;
  if (link != null && !sessions.some((s) => s.start === link)) return err("VALIDATION", "no such session");
  return withLog(r, [...log, { kind: "note", at: iso(now), note: c.value, ...(link != null ? { session: link } : {}) }], now, true);
}
/** Edit a note entry; empty text removes it. */
export function editWorkNote(r: TaskRecord, index: number, note: string, now: Date): Result<Mutation> {
  const log = r.task.worklog ?? [];
  const e = log[index];
  if (!Number.isInteger(index) || e?.kind !== "note") return err("VALIDATION", "no such note");
  const c = checkNote(note);
  if (!c.ok) return c;
  return withLog(r, c.value ? log.with(index, { ...e, note: c.value }) : log.toSpliced(index, 1), now, true);
}

export function resetAxisOverride(
  r: TaskRecord,
  axis: "importance" | "urgency",
  now: Date,
): Result<Mutation> {
  if (r.task.status === "archived") return err("CONFLICT", "restore the task first");
  const had = axis === "importance" ? r.task.userImportanceOverride : r.task.userUrgencyOverride;
  if (!had) return ok({ record: r, events: [] });
  const task: Task = {
    ...bump(r.task, now),
    lastUserEditedAt: iso(now),
    ...(axis === "importance"
      ? { userImportanceOverride: null, importance: r.task.baseImportance }
      : { userUrgencyOverride: null, urgency: r.task.baseUrgency }),
  };
  return ok({ record: { ...r, task }, events: ["override_reset"] });
}

// ── Patch (38.1 null semantics) ──────────────────────────────────────────────
export interface TaskPatch {
  title?: string;
  notes?: string;
  deadline?: Deadline | null;
  startAt?: string | null;
  estimatedMinutes?: number | null;
  contextId?: string | null;
  baseImportance?: number;
  baseUrgency?: number;
  recurrence?: Recurrence | null;
  parentId?: string | null;
  blockedByIds?: string[];
  assignee?: string | null;
  tags?: string[];
}

export function patchTask(
  r: TaskRecord,
  patch: TaskPatch,
  now: Date,
  knownContextIds: ReadonlySet<string>,
  source: Exclude<ValueSource, "default"> = "user",
): Result<Mutation> {
  if (r.task.status === "archived") return err("CONFLICT", "restore the task before editing it");

  const restrictedForCompleted: (keyof TaskPatch)[] = [
    "deadline",
    "startAt",
    "estimatedMinutes",
    "baseImportance",
    "baseUrgency",
  ];
  if (
    r.task.status === "completed" &&
    restrictedForCompleted.some((k) => k in patch)
  ) {
    return err("CONFLICT", "reopen the task to change deadline, progress, or priority");
  }

  const at = iso(now);
  let task = { ...r.task };
  const provenance = { ...r.provenance };
  const events: EventReason[] = [];
  const touched: ProvenanceField[] = [];

  if ("title" in patch) {
    const p = titleSchema.safeParse(patch.title);
    if (!p.success) return err("VALIDATION", p.error.issues[0].message, "title");
    task.title = p.data;
    touched.push("title");
  }
  if ("notes" in patch) {
    const p = notesSchema.safeParse(patch.notes ?? "");
    if (!p.success) return err("VALIDATION", p.error.issues[0].message, "notes");
    task.notes = p.data;
    touched.push("notes");
  }
  if ("deadline" in patch) {
    if (patch.deadline === null) {
      task.deadline = null;
    } else {
      const p = deadlineSchema.safeParse(patch.deadline);
      if (!p.success) return err("VALIDATION", p.error.issues[0].message, "deadline");
      task.deadline = p.data;
    }
    // Rescheduling or clearing the deadline clears the review postponement (41.7).
    task.reviewAfter = null;
    task.deadlineRevision = r.task.deadlineRevision + 1;
    touched.push("deadline");
    events.push("deadline_changed");
  }
  if ("startAt" in patch) {
    if (patch.startAt === null) {
      task.startAt = null;
    } else {
      const p = startAtSchema.safeParse(patch.startAt);
      if (!p.success || p.data === null) {
        return err("VALIDATION", "startAt must be a UTC ISO 8601 string", "startAt");
      }
      task.startAt = p.data;
    }
    touched.push("startAt");
  }
  if ("estimatedMinutes" in patch) {
    if (patch.estimatedMinutes === null) {
      task.estimatedMinutes = null;
    } else {
      const p = estimateSchema.safeParse(patch.estimatedMinutes);
      if (!p.success) return err("VALIDATION", p.error.issues[0].message, "estimatedMinutes");
      task.estimatedMinutes = p.data;
    }
    touched.push("estimatedMinutes");
  }
  if ("contextId" in patch) {
    if (patch.contextId !== null && !knownContextIds.has(patch.contextId!)) {
      return err("VALIDATION", "unknown context", "contextId");
    }
    task.contextId = patch.contextId ?? null;
    touched.push("contextId");
  }
  if ("baseImportance" in patch) {
    if (!axisValue.safeParse(patch.baseImportance).success) {
      return err("VALIDATION", "baseImportance must be within [-1, 1]", "baseImportance");
    }
    task.baseImportance = patch.baseImportance!;
    touched.push("baseImportance");
  }
  if ("baseUrgency" in patch) {
    if (!axisValue.safeParse(patch.baseUrgency).success) {
      return err("VALIDATION", "baseUrgency must be within [-1, 1]", "baseUrgency");
    }
    task.baseUrgency = patch.baseUrgency!;
    touched.push("baseUrgency");
  }

  if (task.startAt != null && task.deadline?.kind === "instant") {
    if (Date.parse(task.startAt) > Date.parse(task.deadline.at)) {
      return err("VALIDATION", "start time is after the deadline", "startAt");
    }
  }

  const extras = validateExtras(patch, r.task.id);
  if (!extras.ok) return extras;
  const extraKeys = Object.keys(extras.value) as (keyof Extras)[];
  const extrasChanged = extraKeys.some(
    (k) => JSON.stringify(extras.value[k] ?? null) !== JSON.stringify(r.task[k] ?? null),
  );
  if (extrasChanged) task = { ...task, ...extras.value };

  if (touched.length === 0 && !extrasChanged) return ok({ record: r, events: [] });

  for (const f of touched) provenance[f] = prov(source, at);
  task = { ...bump(task, now), lastUserEditedAt: at };
  // keep effective coords consistent with (possibly new) base values + existing overrides
  task.importance = task.userImportanceOverride?.value ?? task.baseImportance;
  if (task.userUrgencyOverride == null && task.deadline == null) task.urgency = task.baseUrgency;
  events.push("edited");
  return ok({ record: { task, provenance }, events });
}

// ── Context validation (38.4) — no persistence side effects here ──────────────
export function validateNewContextName(
  name: string,
  existing: readonly Context[],
): Result<string> {
  const p = contextNameOf(name);
  if (!p.ok) return p;
  const folded = foldName(p.value);
  if (existing.some((c) => foldName(c.name) === folded)) {
    return err("VALIDATION", "a context with this name already exists", "name");
  }
  const customCount = existing.filter((c) => !c.seeded).length;
  if (customCount >= LIMITS.contextMax) {
    return err("VALIDATION", "context limit reached (50)", "name");
  }
  return ok(p.value);
}

function contextNameOf(name: string): Result<string> {
  const trimmed = name.trim();
  if (codePoints(trimmed) < LIMITS.contextNameMin) {
    return err("VALIDATION", "context name is required", "name");
  }
  if (codePoints(trimmed) > LIMITS.contextNameMax) {
    return err("VALIDATION", "context name is too long (max 40)", "name");
  }
  return ok(trimmed);
}

// ── Recurrence ──────────────────────────────────────────────────────────
/** Deadline shifted forward by one recurrence step from the given deadline. */
export function shiftDeadline(d: Deadline, rec: Recurrence): Deadline {
  const step = (dt: Date) => {
    if (rec.unit === "day") dt.setUTCDate(dt.getUTCDate() + rec.every);
    else if (rec.unit === "week") dt.setUTCDate(dt.getUTCDate() + 7 * rec.every);
    else {
      const day = dt.getUTCDate();
      dt.setUTCDate(1);
      dt.setUTCMonth(dt.getUTCMonth() + rec.every);
      const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(day, last)); // Jan 31 + 1 month = Feb 28/29
    }
    return dt;
  };
  if (d.kind === "date") return { ...d, date: step(new Date(d.date + "T00:00:00Z")).toISOString().slice(0, 10) };
  // Timed: step the wall-clock time in the deadline's own zone so "the 31st at 23:30" stays on the 31st
  // across UTC day boundaries and DST changes.
  const wall = wallClock(d.at, d.timeZone);
  const shifted = step(new Date(Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi)));
  return { ...d, at: fromWallClock(shifted, d.timeZone).toISOString() };
}

function wallClock(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute") };
}
/** A UTC date carrying wall-clock fields → the real instant in `zone` (two passes to settle across DST). */
function fromWallClock(wallAsUtc: Date, zone: string): Date {
  const offsetAt = (ms: number) => {
    const w = wallClock(new Date(ms).toISOString(), zone);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - ms;
  };
  const guess = wallAsUtc.getTime();
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

/**
 * The next occurrence of a recurring task once this one completes: same fields,
 * deadline advanced past `now` (skips missed periods), progress reset. Returns
 * null when the task does not recur. Ids are injected by the caller.
 */
export function nextOccurrence(task: Task, id: string, now: Date): CreateInput | null {
  if (!task.recurrence) return null;
  let deadline = task.deadline;
  if (deadline) {
    let guard = 0;
    do {
      deadline = shiftDeadline(deadline, task.recurrence);
    } while (instantOrDateMs(deadline) <= now.getTime() && ++guard < 1000);
  }
  return {
    id,
    title: task.title,
    notes: task.notes,
    deadline,
    estimatedMinutes: task.estimatedMinutes,
    contextId: task.contextId,
    baseImportance: task.baseImportance,
    recurrence: task.recurrence,
    parentId: task.parentId ?? null,
    assignee: task.assignee ?? null,
    tags: task.tags ?? [],
    progressSource: task.progressSource,
  };
}

function instantOrDateMs(d: Deadline): number {
  return d.kind === "instant" ? Date.parse(d.at) : Date.parse(d.date + "T23:59:59Z");
}
