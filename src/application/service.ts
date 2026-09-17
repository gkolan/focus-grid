/**
 * Application services — the only path the UI uses to read or mutate tasks.
 * Depends on domain + persistence; never on React. Contract 48.1.
 */
import type { DueWindowFilter } from "@/domain/focus";
import type { Clock } from "@/domain/clock";
import type { Task } from "@/domain/task";
import { type Result, err, ok } from "@/domain/errors";
import {
  archive,
  block,
  complete,
  markStillRelevant,
  patchTask,
  reopen,
  resetAxisOverride,
  restore,
  setAxisOverride,
  setDragOverride,
  addWorkNote,
  editWorkNote,
  startWorkSession,
  stopWorkSession,
  setManualProgress,
  setProgressSource,
  unblock,
  type TaskPatch,
} from "@/domain/commands";
import { calculatePriority, classify, type PriorityResult } from "@/domain/priority";
import { nextOccurrence, reaches } from "@/domain/commands";
import { isDueIn, isWaiting } from "@/domain/focus";
import { focusStats } from "@/domain/stats";
import { googleCalendarUrl, tasksToIcs } from "@/domain/ics";
import { type CalendarFeed, normalizeFeedUrl } from "@/domain/feeds";
import { PRIORITY_CONFIG, type PriorityTuning, withTuning } from "@/domain/config";
import { parseImport, type ImportRow, type ImportSource } from "@/persistence/importers";
import { DEFAULT_CONTEXT_PALETTE } from "@/persistence/db";
import type { TaskTemplate } from "@/persistence/schema";
import { snapshotHtml } from "./share";
import { scoreTask } from "@/domain/score";
import { deadlineCutoffMs } from "@/domain/deadline";
import {
  codePoints,
  type Context,
  type Deadline,
  type ProgressSource,
  type ProvenanceField,
  type TaskRecord,
} from "@/domain/task";
import type { HistorySnapshot } from "@/domain/history";
import { focusRationale, resolveFocus } from "@/domain/focus";
import { type InterpretResponse, validateProposal } from "@/ai/schema";
import { validateImportFile } from "@/persistence/import";
import {
  clearStartedFocus,
  getFocusSession,
  resetSkipped,
  setFocusContextFilter,
  skipFocus,
  startFocus,
  pauseFocus,
} from "./focus-session";
import type { CommandContext, TaskRepository } from "@/persistence/repository";
import { exportSnapshot, serializeExport } from "@/persistence/export";
import type { IDBPDatabase } from "idb";
import type { FocusGridDB } from "@/persistence/schema";

export type CaptureFallback =
  | "timeout"
  | "offline"
  | "unavailable"
  | "invalid"
  | "storage"
  | "cancelled"
  | "rate_limited";

export interface CaptureFieldProposal {
  key: ProvenanceField;
  value: unknown;
  confidence: number | null;
  rationale: string | null;
  ambiguity: string | null;
  sourceText: string | null;
  applied: boolean;
  inferred: boolean;
  needsAcceptance: boolean;
  applicable: boolean;
}

export interface CaptureResult {
  taskId: string;
  revision: number;
  interpretationId: string;
  fields: CaptureFieldProposal[];
  multiTaskNotice: boolean;
}

function mapFallback(code: string | undefined): CaptureFallback {
  switch (code) {
    case "AI_TIMEOUT":
      return "timeout";
    case "AI_INVALID_RESPONSE":
      return "invalid";
    case "AI_UNAVAILABLE":
      return "unavailable";
    case "VALIDATION":
      return "invalid";
    default:
      return "unavailable";
  }
}
function fallbackMessage(code: string | undefined): string {
  if (code === "AI_TIMEOUT") return "AI capture took too long. Your draft is still here.";
  return "AI capture is unavailable. Save without AI.";
}

export type ImportanceChoice = "low" | "medium" | "high" | "untouched";
const IMPORTANCE_VALUE: Record<Exclude<ImportanceChoice, "untouched">, number> = {
  low: -0.6,
  medium: 0,
  high: 0.6,
};

export interface TaskView {
  record: TaskRecord;
  priority: PriorityResult;
  score: number;
  contextName: string;
  contextColor: string | null;
  cutoffMs: number | null;
  /** startAt is in the future relative to the query instant. */
  deferred: boolean;
  /** delegated, or waiting on an unfinished blocker. */
  waiting: boolean;
  blockerTitles: string[];
  childCount: number;
  childDone: number;
  parentTitle: string | null;
}

export interface ManualTaskInput {
  title: string;
  notes?: string;
  deadline?: TaskPatch["deadline"];
  startAt?: string | null;
  estimatedMinutes?: number | null;
  contextId?: string | null;
  /** a label pins an importance override; a number sets the natural base importance */
  importance: ImportanceChoice | number;
  recurrence?: import("@/domain/task").Recurrence | null;
  parentId?: string | null;
  blockedByIds?: string[];
  assignee?: string | null;
  tags?: string[];
}

export class FocusGridApp {
  constructor(
    private readonly repo: TaskRepository,
    private readonly clock: Clock,
    private readonly db: IDBPDatabase<FocusGridDB>,
  ) {}

  private ctx(over: Partial<CommandContext> = {}): CommandContext {
    return { operationId: crypto.randomUUID(), now: this.clock.now(), ...over };
  }

  // ── Queries ────────────────────────────────────────────────────────────────
  async contexts(): Promise<Context[]> {
    return this.repo.listContexts();
  }

  async allViews(): Promise<TaskView[]> {
    const now = this.clock.now();
    const [records, contexts] = await Promise.all([this.repo.listTasks(), this.repo.listContexts()]);
    const byId = new Map(contexts.map((c) => [c.id, c]));
    const cfg = this.repo.priorityConfig;
    const openIds = this.openIds(records);
    const titleOf = new Map(records.map((r) => [r.task.id, r.task.title]));
    const children = new Map<string, Task[]>();
    for (const r of records) {
      if (r.task.parentId) children.set(r.task.parentId, [...(children.get(r.task.parentId) ?? []), r.task]);
    }
    const views = records.map((record): TaskView => {
      const priority = calculatePriority(record.task, now, cfg);
      const c = record.task.contextId ? byId.get(record.task.contextId) : undefined;
      const kids = children.get(record.task.id) ?? [];
      return {
        record,
        priority,
        score: scoreTask(record.task, priority),
        contextName: c?.name ?? "Uncategorized",
        contextColor: c?.color ?? null,
        cutoffMs: record.task.deadline ? deadlineCutoffMs(record.task.deadline) : null,
        deferred: record.task.startAt != null && Date.parse(record.task.startAt) > now.getTime(),
        waiting: isWaiting(record.task, openIds),
        blockerTitles: (record.task.blockedByIds ?? []).filter((id) => openIds.has(id)).map((id) => titleOf.get(id) ?? "(deleted)"),
        childCount: kids.length,
        childDone: kids.filter((k) => k.status === "completed").length,
        parentTitle: record.task.parentId ? (titleOf.get(record.task.parentId) ?? null) : null,
      };
    });
    // A project with no deadline of its own inherits its most urgent open child (subtasks).
    // Deepest projects resolve first so a grandparent sees its child's inherited value, whatever the array order.
    const byTask = new Map(views.map((v) => [v.record.task.id, v]));
    const depth = (id: string, seen = new Set<string>()): number => {
      const p = byTask.get(id)?.record.task.parentId;
      if (!p || seen.has(id) || !byTask.has(p)) return 0;
      seen.add(id);
      return 1 + depth(p, seen);
    };
    for (const v of [...views].sort((a, b) => depth(b.record.task.id) - depth(a.record.task.id))) {
      const t = v.record.task;
      if (v.childCount === 0 || t.deadline || t.userUrgencyOverride) continue;
      const kidUrg = Math.max(-Infinity, ...(children.get(t.id) ?? []).filter((k) => openIds.has(k.id)).map((k) => byTask.get(k.id)!.priority.urgency));
      if (kidUrg > v.priority.urgency) {
        v.priority = { ...v.priority, urgency: kidUrg, quadrant: classify(v.priority.importance, kidUrg) };
        v.score = scoreTask(t, v.priority);
      }
    }
    return views;
  }

  private openIds(records: TaskRecord[]): Set<string> {
    return new Set(records.filter((r) => r.task.status === "active" || r.task.status === "blocked").map((r) => r.task.id));
  }

  /** Inbox: all unfinished (active + blocked, incl. future-start / needsReview), createdAt desc then id (UI-01). */
  async inbox(search?: string): Promise<TaskView[]> {
    const views = (await this.allViews()).filter(
      (v) => v.record.task.status === "active" || v.record.task.status === "blocked",
    );
    const filtered = applySearch(views, search);
    return filtered.sort(byCreatedDesc);
  }

  async completed(search?: string): Promise<TaskView[]> {
    const v = (await this.allViews()).filter((x) => x.record.task.status === "completed");
    return applySearch(v, search).sort(
      (a, b) => cmpStr(b.record.task.completedAt ?? "", a.record.task.completedAt ?? "") || cmpStr(a.record.task.id, b.record.task.id),
    );
  }

  async archived(search?: string): Promise<TaskView[]> {
    const v = (await this.allViews()).filter((x) => x.record.task.status === "archived");
    return applySearch(v, search).sort(
      (a, b) => cmpStr(b.record.task.updatedAt, a.record.task.updatedAt) || cmpStr(a.record.task.id, b.record.task.id),
    );
  }

  async review(search?: string): Promise<TaskView[]> {
    const v = (await this.allViews()).filter(
      (x) =>
        (x.record.task.status === "active" || x.record.task.status === "blocked") &&
        x.priority.needsReview,
    );
    return applySearch(v, search).sort(
      (a, b) => (a.cutoffMs ?? Infinity) - (b.cutoffMs ?? Infinity) || cmpStr(a.record.task.id, b.record.task.id),
    );
  }

  /**
   * Default grid candidate set (UI-01 / 45.3): active + blocked (incl.
   * future-start and needsReview), narrowed by explicit filters, ranked by
   * scoreTask descending then lexical id, capped at 250.
   */
  async gridCandidates(
    opts: { contextIds?: string[]; search?: string; keepIds?: string[]; due?: DueWindowFilter | null; showCompleted?: boolean } = {},
  ): Promise<{ shown: TaskView[]; total: number }> {
    let views = (await this.allViews()).filter(
      (v) => v.record.task.status === "active" || v.record.task.status === "blocked" || (opts.showCompleted && v.record.task.status === "completed"),
    );
    if (opts.contextIds && opts.contextIds.length) {
      const set = new Set(opts.contextIds);
      views = views.filter((v) => set.has(v.record.task.contextId ?? "__uncat__"));
    }
    if (opts.due != null) views = views.filter((v) => isDueIn(v.record.task, opts.due!));
    views = applySearch(views, opts.search);
    const total = views.length;
    // Raw score applies to every candidate — Focus exclusions are independent (RED-117).
    views.sort((a, b) => b.score - a.score || cmpStr(a.record.task.id, b.record.task.id));
    if (total <= 250) return { shown: views, total };

    const keep = new Set(opts.keepIds ?? []);
    const top = views.slice(0, 250);
    const reserved = views
      .slice(250)
      .filter((v) => keep.has(v.record.task.id) && !top.some((t) => t.record.task.id === v.record.task.id));
    // Replace the lowest-ranked unreserved members so we never exceed 250 (RED-115).
    const shown = reserved.length
      ? [...top.slice(0, 250 - reserved.length), ...reserved]
      : top;
    return { shown, total };
  }

  async history(taskId: string): Promise<{ snapshots: HistorySnapshot[]; omittedCount: number }> {
    const [snapshots, meta] = await Promise.all([
      this.repo.historyFor(taskId),
      this.repo.historyMetaFor(taskId),
    ]);
    return {
      snapshots: snapshots.sort((a, b) => a.sequence - b.sequence),
      omittedCount: meta?.omittedCount ?? 0,
    };
  }

  // ── Task commands ──────────────────────────────────────────────────────────
  async createManualTask(input: ManualTaskInput): Promise<Result<{ id: string; revision: number }>> {
    const id = crypto.randomUUID();
    const cycle = await this.wouldCycle(id, input.parentId, input.blockedByIds);
    if (cycle) return cycle;
    const importanceOverride =
      typeof input.importance === "number" || input.importance === "untouched"
        ? undefined
        : IMPORTANCE_VALUE[input.importance];
    const res = await this.repo.create(
      {
        id,
        title: input.title,
        notes: input.notes,
        deadline: input.deadline ?? null,
        startAt: input.startAt ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        contextId: input.contextId ?? null,
        baseImportance: typeof input.importance === "number" ? input.importance : undefined,
        recurrence: input.recurrence ?? null,
        parentId: input.parentId ?? null,
        blockedByIds: input.blockedByIds ?? [],
        assignee: input.assignee ?? null,
        tags: input.tags ?? [],
      },
      this.ctx(),
    );
    if (!res.ok) return res;
    if (importanceOverride !== undefined) {
      const pin = await this.repo.mutate(id, this.ctx({ expectedRevision: res.value.revision }), (r, _k, now) =>
        setAxisOverride(r, "importance", importanceOverride, "editor", now),
      );
      if (!pin.ok) return pin;
      return ok({ id, revision: pin.value.revision });
    }
    return ok({ id, revision: res.value.revision });
  }

  async edit(id: string, revision: number, patch: TaskPatch) {
    const cycle = await this.wouldCycle(id, patch.parentId, patch.blockedByIds);
    if (cycle) return cycle;
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, k, now) =>
      patchTask(r, patch, now, k),
    );
  }

  /** A parent chain or blocker graph that loops back to `self` would never resolve. */
  private async wouldCycle(self: string, parentId?: string | null, blockedByIds?: string[]): Promise<Result<never> | null> {
    if (parentId == null && !blockedByIds?.length) return null;
    const records = await this.repo.listTasks();
    const parentOf = new Map(records.map((r) => [r.task.id, r.task.parentId ?? null]));
    const blockersOf = new Map(records.map((r) => [r.task.id, r.task.blockedByIds ?? []]));
    if (parentId != null && reaches(parentId, self, (id) => (parentOf.get(id) ? [parentOf.get(id)!] : []))) {
      return err("VALIDATION", "that would make the task its own ancestor", "parentId");
    }
    for (const b of blockedByIds ?? []) {
      if (reaches(b, self, (id) => blockersOf.get(id) ?? [])) {
        return err("VALIDATION", "those tasks already wait on this one — that would block both forever", "blockedByIds");
      }
    }
    return null;
  }

  block(id: string, revision: number, reason?: string) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) => block(r, now, reason));
  }
  unblock = this.lifecycle(unblock);
  reopen = this.lifecycle(reopen);
  /** Completing a recurring task spawns its next occurrence. */
  complete = async (id: string, revision: number) => {
    const res = await this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) => complete(r, now));
    if (res.ok && res.value.task.recurrence) {
      const next = nextOccurrence(res.value.task, crypto.randomUUID(), this.clock.now());
      if (next) {
        const spawned = await this.repo.create(next, this.ctx());
        // undoing this completion must also take the spawned occurrence back
        if (spawned.ok) this.undoStack.at(-1)!.spawnedId = spawned.value.task.id;
      }
    }
    return res;
  };

  // ── Global undo — in-memory stack of prior records, this tab only ───────
  // ponytail: session-only; persist to IndexedDB if cross-reload undo is ever wanted.
  private undoStack: (TaskRecord & { spawnedId?: string })[] = [];
  private async mutate(
    id: string,
    ctx: CommandContext,
    fn: (r: TaskRecord, k: Set<string>, now: Date) => Result<import("@/domain/commands").Mutation>,
    opts: { undoable?: boolean } = {},
  ) {
    const prior = await this.repo.getTask(id);
    const res = await this.repo.mutate(id, ctx, fn);
    if (res.ok && prior && res.value.revision !== prior.task.revision && opts.undoable !== false) {
      this.undoStack.push(prior);
      if (this.undoStack.length > 20) this.undoStack.shift();
    }
    return res;
  }
  canUndo(): string | null {
    return this.undoStack.at(-1)?.task.title ?? null;
  }
  async undoLast(): Promise<Result<{ title: string }>> {
    const prior = this.undoStack.pop();
    if (!prior) return err("NOT_FOUND", "Nothing to undo.");
    const cur = await this.repo.getTask(prior.task.id);
    if (!cur) return err("NOT_FOUND", "That task no longer exists.");
    const res = await this.repo.restoreRecord(prior, this.ctx({ expectedRevision: cur.task.revision }));
    if (res.ok && prior.spawnedId) {
      const spawned = await this.repo.getTask(prior.spawnedId);
      // only if it is still the untouched copy we made — the user may have edited it since
      if (spawned && spawned.task.revision === 1) await this.repo.deletePermanently(prior.spawnedId, this.ctx(), 1);
    }
    return res.ok ? ok({ title: prior.task.title }) : res;
  }
  archive = this.lifecycle(archive);
  restore = this.lifecycle(restore);

  private lifecycle(fn: (r: TaskRecord, now: Date) => Result<import("@/domain/commands").Mutation>) {
    return (id: string, revision: number) =>
      this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) => fn(r, now));
  }

  setProgress(id: string, revision: number, percent: number) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) =>
      setManualProgress(r, percent, now),
    );
  }
  setProgressMode(id: string, revision: number, mode: ProgressSource, confirmReset: boolean) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) =>
      setProgressSource(r, mode, now, confirmReset),
    );
  }
  pinAxis(id: string, revision: number, axis: "importance" | "urgency", value: number) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) =>
      setAxisOverride(r, axis, value, "editor", now),
    );
  }
  dragTo(id: string, revision: number, coord: { urgency: number; importance: number }) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) =>
      setDragOverride(r, coord, now),
    );
  }
  resetAxis(id: string, revision: number, axis: "importance" | "urgency") {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) =>
      resetAxisOverride(r, axis, now),
    );
  }

  // ── AI capture (section 43) ────────────────────────────────────────────────
  private captureGen = 0;

  /** Manual save — always available, never blocked by AI. Preserves full input. */
  async saveManualCapture(input: string): Promise<Result<{ task: import("@/domain/task").Task; revision: number }>> {
    this.captureGen++; // invalidate any in-flight interpretation for this tab
    const trimmed = input.trim();
    const title = [...trimmed].slice(0, 200).join("");
    const notes = codePoints(trimmed) > 200 ? trimmed : "";
    return this.repo.create({ id: crypto.randomUUID(), title, notes }, this.ctx());
  }

  /**
   * One interpretation request per submission (43.2). Creates exactly one task
   * with high/medium-confidence fields applied; a late/stale response is dropped
   * by the generation guard (RED-70/72).
   */
  async captureWithAI(
    input: string,
    timeZone: string,
  ): Promise<
    | { ok: true; result: CaptureResult }
    | { ok: false; fallback: CaptureFallback; message: string }
  > {
    const gen = ++this.captureGen;
    const now = this.clock.now();
    const contexts = await this.repo.listContexts();
    const body = {
      schemaVersion: "1" as const,
      purpose: "create" as const,
      input,
      referenceNow: now.toISOString(),
      timeZone,
      contexts: contexts.map((c) => ({ id: c.id, name: c.name })),
    };

    let raw: unknown;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch("/api/ai/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        return { ok: false, fallback: mapFallback(err?.error?.code), message: fallbackMessage(err?.error?.code) };
      }
      raw = await res.json();
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        ok: false,
        fallback: aborted ? "timeout" : "offline",
        message: aborted
          ? "AI capture took too long. Your draft is still here."
          : "AI capture is unavailable offline. You can still save tasks.",
      };
    }

    if (gen !== this.captureGen) {
      return { ok: false, fallback: "cancelled", message: "This capture was cancelled." };
    }

    // Local application boundary — validate again (43.3).
    const v = validateProposal(raw, { input, contexts: body.contexts });
    if (!v.ok) {
      return { ok: false, fallback: "invalid", message: "The AI response wasn’t usable. Save without AI." };
    }

    return this.applyProposal(input, v.response, gen);
  }

  private async applyProposal(
    input: string,
    r: InterpretResponse,
    gen: number,
  ): Promise<{ ok: true; result: CaptureResult } | { ok: false; fallback: CaptureFallback; message: string }> {
    const f = r.fields;
    const HIGH = 0.85;
    const MED = 0.6;
    const applied = (key: keyof typeof f) => {
      const p = f[key];
      if (p.value == null || p.confidence == null) return { apply: false, inferred: false };
      if (p.ambiguity != null) return { apply: false, inferred: false }; // ambiguity overrides confidence
      if (p.confidence >= HIGH) return { apply: true, inferred: false };
      if (p.confidence >= MED) return { apply: true, inferred: true };
      return { apply: false, inferred: false };
    };

    const titleDecision = applied("title");
    const trimmed = input.trim();
    const title =
      titleDecision.apply && typeof f.title.value === "string" && f.title.value.trim()
        ? f.title.value.trim()
        : [...trimmed].slice(0, 200).join("");

    const deadlineApply = applied("deadline");
    const deadlineValue = deadlineApply.apply ? (f.deadline.value as Deadline) : null;
    const estimateApply = applied("estimatedMinutes");
    const contextApply = applied("contextId");
    const importanceApply = applied("baseImportance");

    // preserve the full original input when the title is condensed / multi-task
    const multiTask = /(?:\band\b|;|\n).{6,}/.test(trimmed) && codePoints(trimmed) > codePoints(title) + 12;
    const notes = multiTask || codePoints(trimmed) > 200 ? trimmed : "";

    const interpretationId = crypto.randomUUID();
    const create = await this.repo.create(
      {
        id: crypto.randomUUID(),
        title,
        notes,
        deadline: deadlineValue,
        estimatedMinutes: estimateApply.apply ? (f.estimatedMinutes.value as number) : null,
        contextId: contextApply.apply ? (f.contextId.value as string) : null,
        baseImportance: importanceApply.apply ? (f.baseImportance.value as number) : undefined,
        source: "ai",
        interpretationId,
      },
      this.ctx(),
    );
    if (!create.ok) return { ok: false, fallback: "storage", message: create.error.message };
    const newId = create.value.task.id;
    if (gen !== this.captureGen) {
      // user cancelled while we were saving — remove the just-created task
      await this.repo.deletePermanently(newId, this.ctx());
      return { ok: false, fallback: "cancelled", message: "This capture was cancelled." };
    }

    await this.repo.putInterpretation({
      id: interpretationId,
      taskId: newId,
      provider: "fixture-or-provider",
      model: null,
      schemaVersion: "1",
      at: this.clock.now().toISOString(),
      acceptedFields: Object.fromEntries(
        (Object.keys(f) as (keyof typeof f)[])
          .filter((k) => applied(k as keyof typeof f).apply)
          .map((k) => [k, { confidence: f[k].confidence, rationale: f[k].rationale }]),
      ),
    });

    const fieldViews: CaptureFieldProposal[] = (Object.keys(f) as (keyof typeof f)[]).map((key) => {
      const p = f[key];
      const dec = applied(key);
      const isUrgency = key === "baseUrgency";
      return {
        key: key as ProvenanceField,
        value: p.value,
        confidence: p.confidence,
        rationale: p.rationale,
        ambiguity: p.ambiguity,
        sourceText: p.sourceText,
        applied: isUrgency ? false : dec.apply, // baseUrgency ALWAYS needs acceptance (43.6)
        inferred: dec.inferred,
        needsAcceptance:
          (p.value != null && (!dec.apply || isUrgency)) || p.ambiguity != null,
        applicable: isUrgency ? deadlineValue == null : true,
      };
    });

    return {
      ok: true,
      result: {
        taskId: newId,
        revision: create.value.revision,
        interpretationId,
        fields: fieldViews,
        multiTaskNotice: multiTask,
      },
    };
  }

  /** Accept one previewed field onto the task; it acquires user provenance. */
  async acceptCaptureField(
    taskId: string,
    revision: number,
    key: ProvenanceField,
    value: unknown,
  ): Promise<Result<{ task: import("@/domain/task").Task; revision: number }>> {
    const patch: TaskPatch = {};
    if (key === "title") patch.title = value as string;
    else if (key === "notes") patch.notes = value as string;
    else if (key === "deadline") patch.deadline = (value as Deadline) ?? null;
    else if (key === "startAt") patch.startAt = (value as string) ?? null;
    else if (key === "estimatedMinutes") patch.estimatedMinutes = (value as number) ?? null;
    else if (key === "contextId") patch.contextId = (value as string) ?? null;
    else if (key === "baseImportance") patch.baseImportance = value as number;
    else if (key === "baseUrgency") patch.baseUrgency = value as number;
    return this.mutate(taskId, this.ctx({ expectedRevision: revision }), (r, k, now) =>
      patchTask(r, patch, now, k, "user"),
    );
  }

  cancelCapture(): void {
    this.captureGen++;
  }

  clearInterpretationHistory(): Promise<{ removed: number }> {
    return this.repo.clearInterpretationHistory();
  }

  interpretationsFor(taskId: string) {
    return this.repo.interpretationsFor(taskId);
  }

  // ── Focus (section 44) ─────────────────────────────────────────────────────
  async focus(): Promise<{
    current: (TaskView & { rationale: string[] }) | null;
    emptyReason: import("@/domain/focus").FocusEmptyReason | null;
    recommendationChanged: boolean;
    startedPinned: boolean;
  }> {
    const now = this.clock.now();
    const views = await this.allViews();
    const s = getFocusSession();
    const resolved = resolveFocus(
      views.map((v) => ({ task: v.record.task, priority: v.priority })),
      now,
      { startedTaskId: s.startedTaskId, skipped: s.skipped, contextFilter: s.contextFilter, due: s.due, openIds: this.openIds(views.map((v) => v.record)) },
      views.length,
    );
    const current = resolved.current
      ? (() => {
          const v = views.find((x) => x.record.task.id === resolved.current!.task.id)!;
          return { ...v, rationale: focusRationale(v.record.task, v.priority) };
        })()
      : null;
    return {
      current,
      emptyReason: resolved.emptyReason,
      recommendationChanged: resolved.recommendationChanged,
      startedPinned: s.startedTaskId != null && current?.record.task.id === s.startedTaskId,
    };
  }

  /** Start (or resume) the timer on a task; any other running task is paused first. */
  async focusStart(id: string): Promise<void> {
    await this.focusPause();
    startFocus(id, this.clock.now().getTime());
    const rec = await this.repo.getTask(id);
    if (rec) await this.mutate(id, this.ctx({ expectedRevision: rec.task.revision }), (r, _k, now) => startWorkSession(r, now), { undoable: false });
  }
  /** Stop the running timer and bank the elapsed minutes on the task. */
  async focusPause(): Promise<void> {
    const s = getFocusSession();
    if (s.startedTaskId == null || s.runningSince == null) return;
    const minutes = (this.clock.now().getTime() - s.runningSince) / 60_000;
    const id = s.startedTaskId;
    pauseFocus();
    const rec = await this.repo.getTask(id);
    if (rec) {
      await this.mutate(id, this.ctx({ expectedRevision: rec.task.revision }), (r, _k, now) => stopWorkSession(r, minutes, now), { undoable: false });
    }
  }
  /** Standalone note on the work log, no timer needed. */
  addWorkNote(id: string, revision: number, note: string, session?: string) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) => addWorkNote(r, note, now, session));
  }
  /** Edit a note entry (index into task.worklog); empty removes it. */
  editWorkNote(id: string, revision: number, index: number, note: string) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) => editWorkNote(r, index, note, now));
  }
  /** Minutes on the clock right now, including the running timer. */
  timeSpent(task: Task): number {
    const s = getFocusSession();
    const live = s.startedTaskId === task.id && s.runningSince != null ? (this.clock.now().getTime() - s.runningSince) / 60_000 : 0;
    return (task.timeSpentMinutes ?? 0) + live;
  }
  focusRunning(): string | null {
    const s = getFocusSession();
    return s.runningSince != null ? s.startedTaskId : null;
  }
  async focusClearStarted(): Promise<void> {
    await this.focusPause();
    clearStartedFocus();
  }
  async focusSkip(id: string): Promise<void> {
    if (getFocusSession().startedTaskId === id) await this.focusPause();
    skipFocus(id);
  }
  focusResetSkipped(): void {
    resetSkipped();
  }
  focusSetContextFilter(ids: string[] | null, due: DueWindowFilter | null = null): void {
    setFocusContextFilter(ids, due);
  }
  async focusComplete(id: string, revision: number) {
    revision = await this.settleTimer(id, revision);
    const r = await this.complete(id, revision);
    clearStartedFocus();
    return r;
  }
  async focusBlock(id: string, revision: number) {
    revision = await this.settleTimer(id, revision);
    const r = await this.block(id, revision);
    clearStartedFocus();
    return r;
  }
  /** Bank a running timer before another mutation; returns the revision to expect afterwards. */
  private async settleTimer(id: string, revision: number): Promise<number> {
    if (getFocusSession().startedTaskId !== id || getFocusSession().runningSince == null) return revision;
    await this.focusPause();
    return (await this.repo.getTask(id))?.task.revision ?? revision;
  }

  stillRelevant(id: string, revision: number) {
    return this.mutate(id, this.ctx({ expectedRevision: revision }), (r, _k, now) =>
      markStillRelevant(r, now),
    );
  }
  /** "No longer needed" archives — it never deletes (41.7). */
  noLongerNeeded(id: string, revision: number) {
    return this.archive(id, revision);
  }

  deletePermanently(id: string, revision: number) {
    return this.repo.deletePermanently(id, this.ctx(), revision);
  }

  /** Creation undo — only removes the task if its revision still matches (RED-113). */
  async undoCreate(id: string, creationRevision: number): Promise<Result<{ undone: boolean }>> {
    const current = await this.repo.getTask(id);
    if (!current) return ok({ undone: true });
    if (current.task.revision !== creationRevision) {
      return err("CONFLICT", "This task was edited since you created it — archive it instead.");
    }
    const res = await this.repo.deletePermanently(id, this.ctx(), creationRevision);
    return res.ok ? ok({ undone: true }) : res;
  }

  // ── Contexts ───────────────────────────────────────────────────────────────
  createContext(name: string, color: string) {
    return this.repo.createContext(name, color);
  }
  updateContext(id: string, patch: { name?: string; color?: string }) {
    return this.repo.updateContext(id, patch);
  }
  deleteContext(id: string, reassignTo: string | null) {
    return this.repo.deleteContext(id, reassignTo, this.clock.now());
  }

  // ── Settings + export ──────────────────────────────────────────────────────
  getSettings() {
    return this.repo.getSettings();
  }
  updateSettings(patch: Parameters<TaskRepository["putSettings"]>[0]) {
    return this.repo.putSettings(patch, this.clock.now());
  }

  previewImport(text: string) {
    return validateImportFile(text);
  }
  async importCopies(text: string) {
    const parsed = validateImportFile(text);
    if (!parsed.ok) return parsed;
    return this.repo.importCopies(parsed.value, this.clock.now());
  }
  deleteAllLocalData(): Promise<void> {
    this.captureGen++;
    resetSkipped();
    clearStartedFocus();
    return this.repo.deleteAllLocalData();
  }

  // ── bulk capture ───────────────────────────────────────────────────────
  /** One task per non-empty line. With AI, each line is interpreted in turn; without, saved verbatim. */
  async captureBulk(text: string, timeZone: string, useAi: boolean): Promise<{ created: number; failed: number }> {
    // ponytail: 100 lines per paste — an AI line can take 15s, so this bounds a paste to minutes
    const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean).slice(0, 100);
    let created = 0;
    let failed = 0;
    for (const line of lines) {
      if (useAi) {
        const r = await this.captureWithAI(line, timeZone);
        if (r.ok) created++;
        else {
          const m = await this.saveManualCapture(line);
          if (m.ok) created++;
          else failed++;
        }
      } else {
        const m = await this.saveManualCapture(line);
        if (m.ok) created++;
        else failed++;
      }
    }
    return { created, failed };
  }

  // ── third-party import ─────────────────────────────────────────────────
  previewExternalImport(source: ImportSource, text: string, timeZone: string) {
    return parseImport(source, text, timeZone);
  }
  /** Contexts are matched by name (created when missing); parents resolve by title within the file. */
  async importExternal(rows: ImportRow[]): Promise<Result<{ tasksAdded: number; contextsAdded: number }>> {
    const contexts = await this.repo.listContexts();
    const ctxByName = new Map(contexts.map((c) => [c.name.trim().normalize("NFC").toLocaleLowerCase(), c.id]));
    let contextsAdded = 0;
    const idByTitle = new Map<string, string>();
    let tasksAdded = 0;
    const ordered = [...rows.filter((r) => !r.parentTitle), ...rows.filter((r) => r.parentTitle)];
    for (const row of ordered) {
      let contextId: string | null = null;
      if (row.contextName) {
        const key = row.contextName.normalize("NFC").toLocaleLowerCase();
        contextId = ctxByName.get(key) ?? null;
        if (!contextId) {
          const made = await this.repo.createContext(row.contextName, DEFAULT_CONTEXT_PALETTE[contextsAdded % DEFAULT_CONTEXT_PALETTE.length]);
          if (made.ok) {
            contextId = made.value.id;
            ctxByName.set(key, contextId);
            contextsAdded++;
          }
        }
      }
      const id = crypto.randomUUID();
      const res = await this.repo.create(
        {
          id,
          title: row.title,
          notes: row.notes,
          deadline: row.deadline,
          estimatedMinutes: row.estimatedMinutes,
          contextId,
          baseImportance: row.importance ?? undefined,
          tags: row.tags,
          parentId: row.parentTitle ? (idByTitle.get(row.parentTitle) ?? null) : null,
          source: "import",
        },
        this.ctx(),
      );
      if (!res.ok) continue;
      tasksAdded++;
      idByTitle.set(row.title, id);
      if (row.completed) await this.repo.mutate(id, this.ctx({ expectedRevision: res.value.revision }), (r, _k, now) => complete(r, now));
    }
    return ok({ tasksAdded, contextsAdded });
  }

  // ── calendar, snapshot, stats, timeline ────────────────────────────────
  async exportIcs(): Promise<{ filename: string; ics: string }> {
    const tasks = (await this.repo.listTasks()).map((r) => r.task);
    return { filename: "focusgrid.ics", ics: tasksToIcs(tasks, this.clock.now()) };
  }
  calendarLink(task: Task): string | null {
    return googleCalendarUrl(task);
  }
  async exportSnapshotHtml(): Promise<{ filename: string; html: string }> {
    const views = (await this.allViews()).filter((v) => v.record.task.status === "active" || v.record.task.status === "blocked");
    return { filename: "focusgrid-snapshot.html", html: snapshotHtml(views, this.clock.now()) };
  }
  async stats(zone: string) {
    const tasks = (await this.repo.listTasks()).map((r) => r.task);
    return focusStats(tasks, this.clock.now(), zone);
  }
  /** Newest history snapshots across every task, with titles. */
  async timeline(limit = 60): Promise<Array<HistorySnapshot & { title: string }>> {
    const records = await this.repo.listTasks();
    const out: Array<HistorySnapshot & { title: string }> = [];
    for (const r of records) {
      for (const s of await this.repo.historyFor(r.task.id)) out.push({ ...s, title: r.task.title });
    }
    return out.sort((a, b) => cmpStr(b.timestamp, a.timestamp)).slice(0, limit);
  }

  // ── priority tuning, templates ─────────────────────────────────────────
  async setTuning(t: PriorityTuning | null) {
    await this.updateSettings({ priorityTuning: t });
    this.repo.setPriorityConfig(withTuning(PRIORITY_CONFIG, t));
    await this.repo.recalcPass(this.clock.now());
  }
  tuning(): PriorityTuning {
    const c = this.repo.priorityConfig;
    return { deadlineWeight: c.deadlineWeight, effortWeight: c.effortWeight, overdueWeight: c.overdueWeight, overdueSaturationMinutes: c.overdueSaturationMinutes, staleAfterMinutes: c.staleAfterMinutes };
  }
  async templates(): Promise<TaskTemplate[]> {
    return (await this.repo.getSettings())?.templates ?? [];
  }
  async saveTemplate(t: Omit<TaskTemplate, "id">): Promise<TaskTemplate> {
    const all = await this.templates();
    const made = { ...t, id: crypto.randomUUID() };
    await this.updateSettings({ templates: [...all.filter((x) => x.name !== t.name), made].slice(-50) });
    return made;
  }
  async deleteTemplate(id: string): Promise<void> {
    await this.updateSettings({ templates: (await this.templates()).filter((x) => x.id !== id) });
  }

  // ── public calendar feeds (read-only overlays) ─────────────────────────
  async calendarFeeds(): Promise<CalendarFeed[]> {
    return (await this.repo.getSettings())?.calendarFeeds ?? [];
  }
  async addCalendarFeed(name: string, rawUrl: string): Promise<Result<CalendarFeed>> {
    const url = normalizeFeedUrl(rawUrl);
    if (!url) return err("VALIDATION", "Paste a public http(s) or webcal calendar link.");
    const all = await this.calendarFeeds();
    const existing = all.find((f) => f.url === url);
    if (existing) return ok(existing);
    if (all.length >= 20) return err("VALIDATION", "Up to 20 calendar feeds.");
    const made: CalendarFeed = { id: crypto.randomUUID(), name: name.trim() || new URL(url).hostname, url, color: DEFAULT_CONTEXT_PALETTE[all.length % DEFAULT_CONTEXT_PALETTE.length] };
    await this.updateSettings({ calendarFeeds: [...all, made] });
    return ok(made);
  }
  async removeCalendarFeed(id: string): Promise<void> {
    await this.updateSettings({ calendarFeeds: (await this.calendarFeeds()).filter((f) => f.id !== id) });
  }

  async exportBackup(): Promise<{ filename: string; json: string }> {
    const now = this.clock.now();
    const env = await exportSnapshot(this.db, now);
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return { filename: `focusgrid-backup-${stamp}.json`, json: serializeExport(env) };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function byCreatedDesc(a: TaskView, b: TaskView): number {
  return (
    cmpStr(b.record.task.createdAt, a.record.task.createdAt) ||
    cmpStr(a.record.task.id, b.record.task.id)
  );
}
function applySearch(views: TaskView[], search?: string): TaskView[] {
  const q = search?.trim().normalize("NFC").toLocaleLowerCase();
  if (!q) return views;
  const fold = (x: string) => x.normalize("NFC").toLocaleLowerCase();
  return views.filter((v) => {
    const t = v.record.task;
    if (q.startsWith("#")) return (t.tags ?? []).some((tag) => fold(tag).includes(q.slice(1)));
    if (q.startsWith("@")) return fold(t.assignee ?? "").includes(q.slice(1));
    return (
      fold(t.title).includes(q) ||
      fold(t.notes).includes(q) ||
      (t.tags ?? []).some((tag) => fold(tag).includes(q)) ||
      fold(t.assignee ?? "").includes(q)
    );
  });
}
