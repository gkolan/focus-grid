/**
 * Transactional unit of work over the IndexedDB task authority — contract 42.2.
 * Every task mutation: dedupe check → load latest → revision check → apply pure
 * command → recalc priority → append meaningful history → persist, all in ONE
 * transaction. A failed write rolls back task + provenance + history together
 * and never records "committed".
 */
import type { IDBPDatabase, IDBPTransaction } from "idb";
import { PRIORITY_CONFIG, type PriorityConfig } from "@/domain/config";
import { type DomainError, type Result, err, ok } from "@/domain/errors";
import {
  HISTORY_RETENTION,
  type HistoryReason,
  type HistorySnapshot,
  shouldSnapshot,
} from "@/domain/history";
import {
  type Mutation,
  createTask,
  type CreateInput,
  validateNewContextName,
} from "@/domain/commands";
import { calculatePriority, withRecalculatedPriority } from "@/domain/priority";
import { type Context, LIMITS, type TaskProvenance, type TaskRecord, type Task } from "@/domain/task";
import { deadlineCutoffMs } from "@/domain/deadline";
import { type FocusGridDB, OP_DEDUPE_MS, type SettingsRecord } from "./schema";

export const DEFAULT_SETTINGS: SettingsRecord = {
  key: "app",
  timeZone: null,
  theme: "system",
  sidebarPinned: false,
  notificationsEnabled: false,
  notificationTitles: false,
  quietHours: { start: "21:00", end: "08:00" },
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export interface CommandContext {
  operationId: string;
  now: Date;
  /** Required for commands on an existing task (42.2). */
  expectedRevision?: number;
}

export interface RepositoryHooks {
  /** Test seam: throw here to simulate a mid-transaction quota/abort failure. */
  beforeCommit?: () => void | Promise<void>;
  /** Called after a committed write so other tabs can invalidate. */
  onCommitted?: (taskId: string, revision: number) => void;
  /** committed task + the domain events it produced (webhooks). */
  onEvents?: (task: Task, events: string[]) => void;
}

const TX_STORES = ["tasks", "provenance", "history", "historyMeta", "operations", "contexts"] as const;
type Tx = IDBPTransaction<FocusGridDB, typeof TX_STORES, "readwrite">;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWriteTx = IDBPTransaction<FocusGridDB, any, "readwrite">;

const eventToHistoryReason: Partial<Record<string, HistoryReason>> = {
  created: "created",
  override_set: "override_set",
  override_reset: "override_reset",
  deadline_changed: "deadline_changed",
  progress_changed: "progress_changed",
};

export class TaskRepository {
  constructor(
    private readonly db: IDBPDatabase<FocusGridDB>,
    private config: PriorityConfig = PRIORITY_CONFIG,
    private readonly hooks: RepositoryHooks = {},
    private readonly readOnly = false,
  ) {}

  /** tuning: the engine config every read and write uses from now on. */
  get priorityConfig(): PriorityConfig {
    return this.config;
  }
  setPriorityConfig(cfg: PriorityConfig): void {
    this.config = cfg;
  }

  /** global undo: put a prior record back verbatim (revision bumps, history notes "edited"). */
  restoreRecord(prior: TaskRecord, ctx: CommandContext) {
    return this.mutate(prior.task.id, ctx, (cur, _k, now) =>
      ok({
        record: { task: { ...prior.task, revision: cur.task.revision, updatedAt: now.toISOString() }, provenance: prior.provenance },
        events: ["edited"],
      }),
    );
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  async listContexts(): Promise<Context[]> {
    return this.db.getAll("contexts");
  }

  async knownContextIds(): Promise<Set<string>> {
    return new Set((await this.listContexts()).map((c) => c.id));
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    const task = await this.db.get("tasks", id);
    if (!task) return null;
    const prov = await this.db.get("provenance", id);
    return { task, provenance: stripTaskId(prov) };
  }

  async listTasks(): Promise<TaskRecord[]> {
    const tasks = await this.db.getAll("tasks");
    const out: TaskRecord[] = [];
    for (const task of tasks) {
      const prov = await this.db.get("provenance", task.id);
      out.push({ task, provenance: stripTaskId(prov) });
    }
    return out;
  }

  async historyFor(taskId: string): Promise<HistorySnapshot[]> {
    return this.db.getAllFromIndex("history", "by_task", taskId);
  }

  async historyMetaFor(taskId: string) {
    return this.db.get("historyMeta", taskId);
  }

  // ── AI interpretation metadata (43.5) ──────────────────────────────────────
  async putInterpretation(rec: import("./schema").InterpretationRecord): Promise<void> {
    await this.db.put("interpretations", rec);
  }

  async interpretationsFor(taskId: string) {
    return this.db.getAllFromIndex("interpretations", "by_task", taskId);
  }

  /**
   * Clear AI interpretation history (RED-83): delete every interpretation record
   * and drop the interpretationId link from provenance, keeping `source: "ai"`.
   * Tasks, overrides and accepted values are untouched.
   */
  async clearInterpretationHistory(): Promise<{ removed: number }> {
    const tx = this.db.transaction(["interpretations", "provenance"], "readwrite");
    try {
      const all = await tx.objectStore("interpretations").getAll();
      for (const r of all) await tx.objectStore("interpretations").delete(r.id);
      let cursor = await tx.objectStore("provenance").openCursor();
      while (cursor) {
        const p = cursor.value;
        let touched = false;
        for (const k of Object.keys(p) as (keyof typeof p)[]) {
          const field = p[k];
          if (field && typeof field === "object" && "interpretationId" in field && field.interpretationId != null) {
            (field as { interpretationId: string | null }).interpretationId = null;
            touched = true;
          }
        }
        if (touched) await cursor.update(p);
        cursor = await cursor.continue();
      }
      await tx.done;
      return { removed: all.length };
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* noop */
      }
      await tx.done.catch(() => {});
      throw e;
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  async create(input: CreateInput, ctx: CommandContext): Promise<Result<{ task: Task; revision: number }>> {
    const known = await this.knownContextIds();
    return this.commit(ctx, input.id, async (tx) => {
      const existing = await tx.objectStore("tasks").get(input.id);
      if (existing) return err("CONFLICT", "a task with this id already exists");
      const built = createTask(input, ctx.now, known);
      if (!built.ok) return built;
      return built;
    });
  }

  // ── Mutate an existing task ────────────────────────────────────────────────
  async mutate(
    taskId: string,
    ctx: CommandContext,
    apply: (record: TaskRecord, known: Set<string>, now: Date) => Result<Mutation>,
  ): Promise<Result<{ task: Task; revision: number }>> {
    if (ctx.expectedRevision == null) {
      return err("VALIDATION", "expectedRevision is required for existing-task commands");
    }
    const known = await this.knownContextIds();
    return this.commit(ctx, taskId, async (tx) => {
      const task = await tx.objectStore("tasks").get(taskId);
      if (!task) return err("NOT_FOUND", "this task no longer exists");
      if (task.revision !== ctx.expectedRevision) {
        return { ok: false as const, error: conflict() };
      }
      const prov = stripTaskId(await tx.objectStore("provenance").get(taskId));
      return apply({ task, provenance: prov }, known, ctx.now);
    });
  }

  // ── The unit of work ───────────────────────────────────────────────────────
  private async commit(
    ctx: CommandContext,
    taskId: string,
    produce: (tx: Tx) => Promise<Result<Mutation>>,
  ): Promise<Result<{ task: Task; revision: number }>> {
    if (this.readOnly) return err("STORAGE_UNAVAILABLE", "FocusGrid is in read-only recovery mode");

    // Idempotency: a replayed operation returns its recorded outcome (RED-71).
    const prior = await this.db.get("operations", ctx.operationId);
    if (prior) {
      if (prior.outcome === "committed" && prior.taskId) {
        const t = await this.db.get("tasks", prior.taskId);
        if (t) return ok({ task: t, revision: t.revision });
      }
      return replayError(prior.outcome);
    }

    const tx = this.db.transaction(TX_STORES, "readwrite");
    let result: Result<{ task: Task; revision: number }>;
    let committedEvents: string[] = [];
    try {
      const produced = await produce(tx);
      if (!produced.ok) {
        await recordOp(tx, ctx, outcomeFor(produced.error), null, null);
        await tx.done;
        return produced;
      }

      const { record, events } = produced.value;
      committedEvents = events;
      const recalced = withRecalculatedPriority(record.task, ctx.now, this.config);
      const finalTask = recalced.task;
      const priority = recalced.priority;

      await this.appendHistory(tx, finalTask, priority, mapReasons(events));

      await tx.objectStore("tasks").put(finalTask);
      await tx.objectStore("provenance").put({ ...record.provenance, taskId: finalTask.id });
      await recordOp(tx, ctx, "committed", finalTask.id, finalTask.revision);

      if (this.hooks.beforeCommit) await this.hooks.beforeCommit();
      await tx.done;
      result = ok({ task: finalTask, revision: finalTask.revision });
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* already aborted / done */
      }
      // Swallow the abort rejection so it is not an unhandled rejection.
      await tx.done.catch(() => {});
      return storageError(e);
    }

    this.hooks.onCommitted?.(taskId, result.ok ? result.value.revision : 0);
    if (result.ok) this.hooks.onEvents?.(result.value.task, committedEvents);
    void this.pruneOperations(ctx.now);
    return result;
  }

  private async appendHistory(
    tx: Tx,
    task: Task,
    priority: ReturnType<typeof calculatePriority>,
    reasons: HistoryReason[],
  ): Promise<void> {
    const store = tx.objectStore("history");
    const existing = (await store.index("by_task").getAll(task.id)) as HistorySnapshot[];
    existing.sort((a, b) => a.sequence - b.sequence);
    const last = existing[existing.length - 1] ?? null;
    const critical = priority.urgency >= 0.8;

    const decision = shouldSnapshot(
      { ...priority, critical },
      reasons,
      last,
      last
        ? {
            quadrant: quadrantOfSnapshot(last),
            critical: last.urgencyPinned ? last.urgency >= 0.8 : last.automaticUrgency >= 0.8,
            needsReview: false,
          }
        : null,
    );
    if (!decision.append) return;

    const seq = last ? last.sequence + 1 : 0;
    const snap: HistorySnapshot = {
      taskId: task.id,
      sequence: seq,
      taskRevision: task.revision,
      timestamp: task.lastCalculatedAt,
      importance: priority.importance,
      urgency: priority.urgency,
      automaticUrgency: priority.automaticUrgency,
      deadlinePressure: priority.deadlinePressure,
      effortPressure: priority.effortPressure,
      overduePressure: priority.overduePressure,
      reason: decision.reasons,
      engineVersion: priority.engineVersion,
      importancePinned: task.userImportanceOverride != null,
      urgencyPinned: task.userUrgencyOverride != null,
    };
    await store.put(snap);

    // Retention: initial (seq 0) + newest 499 (42.3).
    const total = existing.length + 1;
    if (total > HISTORY_RETENTION) {
      const removable = existing.filter((s) => s.sequence !== 0).sort((a, b) => a.sequence - b.sequence);
      const toRemove = removable.slice(0, total - HISTORY_RETENTION);
      for (const s of toRemove) await store.delete([s.taskId, s.sequence]);
      const meta = tx.objectStore("historyMeta");
      const prev = await meta.get(task.id);
      const last2 = toRemove[toRemove.length - 1];
      await meta.put({
        taskId: task.id,
        omittedCount: (prev?.omittedCount ?? 0) + toRemove.length,
        omittedThroughSequence: last2?.sequence ?? prev?.omittedThroughSequence ?? null,
        omittedThroughDate: last2?.timestamp ?? prev?.omittedThroughDate ?? null,
      });
    }
  }

  /**
   * Background recalculation for one active/blocked task (42.1). Persists only a
   * real change: coordinate move ≥ 1e-4, a quadrant/critical/review flag flip,
   * or a due meaningful snapshot. Never touches `lastUserEditedAt`. Completed and
   * archived tasks are skipped entirely (RED-23). Returns whether the effective
   * coordinates moved enough to animate (≥ meaningfulAxisDelta).
   */
  async backgroundRecalc(
    taskId: string,
    now: Date,
  ): Promise<{ changed: boolean; animate: boolean; events: import("@/domain/notifications").NotificationEvent[] }> {
    const empty = { changed: false, animate: false, events: [] as import("@/domain/notifications").NotificationEvent[] };
    if (this.readOnly) return empty;
    const { detectEvents } = await import("@/domain/notifications");
    const { scoreTask } = await import("@/domain/score");
    const tx = this.db.transaction(TX_STORES, "readwrite");
    try {
      const task = await tx.objectStore("tasks").get(taskId);
      if (!task || (task.status !== "active" && task.status !== "blocked")) {
        await tx.done;
        return empty;
      }
      // Detect notification crossings over [lastCalculatedAt, now].
      const prevInstant = new Date(task.lastCalculatedAt);
      const beforeP = calculatePriority(task, prevInstant, this.config);
      const recalced = withRecalculatedPriority(task, now, this.config);
      const p = recalced.priority;
      const events = detectEvents(task, beforeP, p, now, scoreTask(task, p));
      const dImp = Math.abs(p.importance - task.importance);
      const dUrg = Math.abs(p.urgency - task.urgency);

      // Would a meaningful snapshot be due?
      const existing = (
        (await tx.objectStore("history").index("by_task").getAll(taskId)) as HistorySnapshot[]
      ).sort((a, b) => a.sequence - b.sequence);
      const last = existing[existing.length - 1] ?? null;
      const decision = shouldSnapshot(
        { ...p, critical: p.urgency >= 0.8 },
        [],
        last,
        last
          ? {
              quadrant: quadrantOfSnapshot(last),
              critical: last.automaticUrgency >= 0.8,
              needsReview: false,
            }
          : null,
      );

      if (dImp < 1e-4 && dUrg < 1e-4 && !decision.append && events.length === 0) {
        await tx.done; // no-op (same instant/inputs → nothing to persist)
        return empty;
      }

      const finalTask: Task = {
        ...recalced.task,
        revision: task.revision + 1,
        updatedAt: now.toISOString(),
      };
      if (decision.append) {
        await this.appendHistory(tx, finalTask, p, []);
      }
      if (dImp >= 1e-4 || dUrg >= 1e-4 || decision.append) {
        await tx.objectStore("tasks").put(finalTask);
        await tx.done;
        this.hooks.onCommitted?.(taskId, finalTask.revision);
      } else {
        await tx.done;
      }
      return {
        changed: dImp >= 1e-4 || dUrg >= 1e-4 || decision.append,
        animate: dImp >= this.config.meaningfulAxisDelta || dUrg >= this.config.meaningfulAxisDelta,
        events,
      };
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* noop */
      }
      await tx.done.catch(() => {});
      void e;
      return empty;
    }
  }

  /** One recalculation pass over every active/blocked task at a single instant. */
  async recalcPass(
    now: Date,
  ): Promise<{ recalculated: number; animatedIds: string[]; events: import("@/domain/notifications").NotificationEvent[] }> {
    const ids = (await this.db.getAll("tasks"))
      .filter((t) => t.status === "active" || t.status === "blocked")
      .map((t) => t.id);
    let recalculated = 0;
    const animatedIds: string[] = [];
    const events: import("@/domain/notifications").NotificationEvent[] = [];
    for (const id of ids) {
      const r = await this.backgroundRecalc(id, now);
      if (r.changed) recalculated++;
      if (r.animate) animatedIds.push(id);
      events.push(...r.events);
    }
    return { recalculated, animatedIds, events };
  }

  // ── Permanent delete (46.5) — cascades to all dependent local records ──────
  async deletePermanently(
    taskId: string,
    ctx: CommandContext,
    expectedRevision?: number,
  ): Promise<Result<{ id: string }>> {
    if (this.readOnly) return err("STORAGE_UNAVAILABLE", "read-only recovery mode");
    const prior = await this.db.get("operations", ctx.operationId);
    if (prior) return prior.outcome === "committed" ? ok({ id: taskId }) : replayError(prior.outcome);

    const tx = this.db.transaction(
      ["tasks", "provenance", "history", "historyMeta", "interpretations", "eventClaims", "operations"],
      "readwrite",
    );
    try {
      const task = await tx.objectStore("tasks").get(taskId);
      if (!task) {
        await recordOp(tx, ctx, "validation", null, null);
        await tx.done;
        return err("NOT_FOUND", "this task no longer exists");
      }
      if (expectedRevision != null && task.revision !== expectedRevision) {
        await recordOp(tx, ctx, "conflict", null, null);
        await tx.done;
        return err("CONFLICT", "the task changed — it was not deleted");
      }
      await tx.objectStore("tasks").delete(taskId);
      await tx.objectStore("provenance").delete(taskId);
      await tx.objectStore("historyMeta").delete(taskId);
      for (const s of await tx.objectStore("history").index("by_task").getAll(taskId)) {
        await tx.objectStore("history").delete([s.taskId, s.sequence]);
      }
      for (const r of await tx.objectStore("interpretations").index("by_task").getAll(taskId)) {
        await tx.objectStore("interpretations").delete(r.id);
      }
      for (const c of await tx.objectStore("eventClaims").index("by_task").getAll(taskId)) {
        await tx.objectStore("eventClaims").delete(c.key);
      }
      await recordOp(tx, ctx, "committed", taskId, null);
      await tx.done;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* noop */
      }
      await tx.done.catch(() => {});
      return storageError(e);
    }
    this.hooks.onCommitted?.(taskId, 0);
    return ok({ id: taskId });
  }

  // ── Notifications (section 47) ────────────────────────────────────────────
  async recentEventClaims(sinceMs: number): Promise<import("./schema").EventClaimRecord[]> {
    const all = await this.db.getAll("eventClaims");
    return all
      .filter((c) => Date.parse(c.claimedAt) >= sinceMs)
      .sort((a, b) => (a.claimedAt < b.claimedAt ? 1 : -1));
  }

  /**
   * Durably claim one notification event and decide delivery (47.1–47.2).
   * A claim that already exists is never re-attempted (RED-89/126), even
   * sequentially or after restart. Eligibility is re-checked right before
   * delivery (RED-91). Suppressed events are marked, never queued for a burst.
   */
  async claimNotification(
    event: import("@/domain/notifications").NotificationEvent,
    now: Date,
    ctx: {
      quietHours: { start: string; end: string } | null;
      timeZone: string;
      showTitles?: boolean;
    },
    deliver: (body: string, task: Task) => Promise<boolean>,
  ): Promise<"delivered" | "failed" | "suppressed" | "already_claimed"> {
    const { isNotificationEligible, isWithinQuietHours, notificationText, NOTIFICATION_COOLDOWN_MS, NOTIFICATION_HOURLY_CAP } =
      await import("@/domain/notifications");

    const existing = await this.db.get("eventClaims", event.key);
    if (existing) return "already_claimed";

    const task = await this.db.get("tasks", event.taskId);
    const nowMs = now.getTime();

    // re-validate eligibility just before delivery
    const priority = task ? calculatePriority(task, now) : null;
    let suppressReason: string | null = null;
    if (!task || !priority || !isNotificationEligible(task, priority, now)) {
      suppressReason = "not_eligible";
    } else if (isWithinQuietHours(now, ctx.quietHours, ctx.timeZone)) {
      suppressReason = "quiet_hours";
    } else {
      const recent = await this.recentEventClaims(nowMs - 60 * 60_000);
      const deliveredThisHour = recent.filter((c) => c.delivered === "delivered").length;
      const taskCooldownHit = (await this.db.getAll("eventClaims")).some(
        (c) =>
          c.taskId === event.taskId &&
          c.delivered === "delivered" &&
          c.deliveredAt != null &&
          nowMs - Date.parse(c.deliveredAt) < NOTIFICATION_COOLDOWN_MS,
      );
      if (taskCooldownHit) suppressReason = "task_cooldown";
      else if (deliveredThisHour >= NOTIFICATION_HOURLY_CAP) suppressReason = "hourly_cap";
    }

    const record: import("./schema").EventClaimRecord = {
      key: event.key,
      taskId: event.taskId,
      eventType: event.type,
      deadlineRevision: event.deadlineRevision,
      claimedAt: now.toISOString(),
      delivered: suppressReason ? "suppressed" : "pending",
      deliveredAt: null,
      suppressReason,
      body: notificationText(
        event.type,
        ctx.showTitles && task ? task.title : null,
      ).body,
    };

    // atomic claim
    const tx = this.db.transaction("eventClaims", "readwrite");
    if (await tx.store.get(event.key)) {
      await tx.done;
      return "already_claimed";
    }
    await tx.store.put(record);
    await tx.done;

    if (suppressReason) return "suppressed";

    const ok = await deliver(record.body, task!);
    const final = await this.db.get("eventClaims", event.key);
    if (final) {
      final.delivered = ok ? "delivered" : "failed";
      final.deliveredAt = ok ? now.toISOString() : null;
      await this.db.put("eventClaims", final);
    }
    return ok ? "delivered" : "failed";
  }

  /**
   * Long-resume summary (47.2): at most one, still obeying quiet hours and the
   * hourly cap. Individual events are claimed+suppressed by the caller.
   */
  async claimSummary(
    stampKey: string,
    now: Date,
    ctx: { quietHours: { start: string; end: string } | null; timeZone: string },
    deliver: (body: string) => Promise<boolean>,
  ): Promise<"delivered" | "failed" | "suppressed" | "already_claimed"> {
    const { isWithinQuietHours, NOTIFICATION_HOURLY_CAP } = await import("@/domain/notifications");
    const key = `summary::${stampKey}`;
    if (await this.db.get("eventClaims", key)) return "already_claimed";
    const nowMs = now.getTime();
    const deliveredThisHour = (await this.recentEventClaims(nowMs - 60 * 60_000)).filter(
      (c) => c.delivered === "delivered",
    ).length;
    const suppress =
      isWithinQuietHours(now, ctx.quietHours, ctx.timeZone) || deliveredThisHour >= NOTIFICATION_HOURLY_CAP;
    const body = "Some tasks changed while you were away.";
    await this.db.put("eventClaims", {
      key,
      taskId: "—",
      eventType: "summary",
      deadlineRevision: 0,
      claimedAt: now.toISOString(),
      delivered: suppress ? "suppressed" : "pending",
      deliveredAt: null,
      suppressReason: suppress ? "quiet_or_cap" : null,
      body,
    });
    if (suppress) return "suppressed";
    const ok = await deliver(body);
    const rec = await this.db.get("eventClaims", key);
    if (rec) {
      rec.delivered = ok ? "delivered" : "failed";
      rec.deliveredAt = ok ? now.toISOString() : null;
      await this.db.put("eventClaims", rec);
    }
    return ok ? "delivered" : "failed";
  }

  async claimSuppressed(event: import("@/domain/notifications").NotificationEvent, now: Date): Promise<void> {
    if (await this.db.get("eventClaims", event.key)) return;
    const { notificationText } = await import("@/domain/notifications");
    await this.db.put("eventClaims", {
      key: event.key,
      taskId: event.taskId,
      eventType: event.type,
      deadlineRevision: event.deadlineRevision,
      claimedAt: now.toISOString(),
      delivered: "suppressed",
      deliveredAt: null,
      suppressReason: "resume_summary",
      body: notificationText(event.type, null).body,
    });
  }

  // ── Import (Add as copies) + delete-all (46.3 / 46.5) ─────────────────────
  async importCopies(
    parsed: import("./import").ParsedImport,
    now: Date,
  ): Promise<Result<{ tasksAdded: number; contextsAdded: number }>> {
    if (this.readOnly) return err("STORAGE_UNAVAILABLE", "read-only recovery mode");
    const { matchContextByName } = await import("./import");
    const env = parsed.envelope;
    const existingContexts = await this.listContexts();
    const existingTaskCount = await this.db.count("tasks");
    if (existingTaskCount + parsed.taskCount > LIMITS.taskCap) {
      return err(
        "QUOTA_EXCEEDED",
        `Importing would exceed the ${LIMITS.taskCap.toLocaleString()}-task limit. Nothing was imported.`,
      );
    }

    const tx = this.db.transaction(
      ["tasks", "provenance", "contexts", "history", "historyMeta", "interpretations"],
      "readwrite",
    );
    try {
      // remap context ids: reuse a same-named local context, else create a copy
      const ctxMap = new Map<string, string>();
      let contextsAdded = 0;
      for (const c of env.contexts) {
        const match = matchContextByName(c.name, existingContexts);
        if (match) {
          ctxMap.set(c.id, match);
        } else {
          const newId = crypto.randomUUID();
          ctxMap.set(c.id, newId);
          await tx.objectStore("contexts").add({ id: newId, name: c.name, color: c.color, seeded: false });
          contextsAdded++;
        }
      }

      const taskMap = new Map<string, string>();
      for (const t of env.tasks) taskMap.set(t.id, crypto.randomUUID());

      const provByTask = new Map<string, (typeof env.provenance)[number]>();
      for (const p of env.provenance) provByTask.set((p as { taskId: string }).taskId, p);

      let tasksAdded = 0;
      for (const src of env.tasks) {
        const id = taskMap.get(src.id)!;
        let task: Task = {
          ...src,
          id,
          contextId: src.contextId != null ? (ctxMap.get(src.contextId) ?? null) : null,
        };
        // recompute coordinates for active/blocked from validated base+override
        if (task.status === "active" || task.status === "blocked") {
          task = withRecalculatedPriority(task, now, this.config).task;
        }
        await tx.objectStore("tasks").put(task);

        const srcProv = provByTask.get(src.id) as Record<string, unknown> | undefined;
        const provenance = srcProv
          ? { ...srcProv, taskId: id }
          : ({ taskId: id } as Record<string, unknown>);
        await tx.objectStore("provenance").put(provenance as never);
        tasksAdded++;
      }

      // preserve completed/archived history snapshots; drop live-task history
      // (it will rebuild) — keeps the import bounded and coordinates fresh
      for (const h of env.history) {
        const srcTaskId = (h as { taskId: string }).taskId;
        const src = env.tasks.find((t) => t.id === srcTaskId);
        if (!src || (src.status !== "completed" && src.status !== "archived")) continue;
        const newTaskId = taskMap.get(srcTaskId)!;
        await tx.objectStore("history").put({ ...(h as object), taskId: newTaskId } as never);
      }

      for (const r of env.interpretations) {
        const newTaskId = taskMap.get((r as { taskId: string }).taskId);
        if (!newTaskId) continue;
        await tx.objectStore("interpretations").put({
          ...(r as object),
          id: crypto.randomUUID(),
          taskId: newTaskId,
        } as never);
      }

      await tx.done;
      this.hooks.onCommitted?.("import", 0);
      return ok({ tasksAdded, contextsAdded });
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* noop */
      }
      await tx.done.catch(() => {});
      return storageError(e);
    }
  }

  /** Delete all local data — every store + settings + drafts (46.5). Re-seeds contexts. */
  async deleteAllLocalData(): Promise<void> {
    const stores = [
      "tasks",
      "provenance",
      "contexts",
      "history",
      "historyMeta",
      "interpretations",
      "settings",
      "operations",
      "eventClaims",
    ] as const;
    const tx = this.db.transaction(stores, "readwrite");
    for (const s of stores) await tx.objectStore(s).clear();
    await tx.done;
    const { seedDefaultContexts } = await import("./db");
    await seedDefaultContexts(this.db);
    this.hooks.onCommitted?.("delete-all", 0);
  }

  // ── Contexts (38.4) ────────────────────────────────────────────────────────
  async createContext(name: string, color: string): Promise<Result<Context>> {
    const existing = await this.listContexts();
    const validated = validateNewContextName(name, existing);
    if (!validated.ok) return validated;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return err("VALIDATION", "invalid colour", "color");
    const ctx: Context = { id: crypto.randomUUID(), name: validated.value, color, seeded: false };
    await this.db.put("contexts", ctx);
    return ok(ctx);
  }

  async updateContext(
    id: string,
    patch: { name?: string; color?: string },
  ): Promise<Result<Context>> {
    const existing = await this.listContexts();
    const current = existing.find((c) => c.id === id);
    if (!current) return err("NOT_FOUND", "context not found");
    let name = current.name;
    if (patch.name != null && patch.name !== current.name) {
      const v = validateNewContextName(
        patch.name,
        existing.filter((c) => c.id !== id),
      );
      if (!v.ok) return v;
      name = v.value;
    }
    let color = current.color;
    if (patch.color != null) {
      if (!/^#[0-9a-fA-F]{6}$/.test(patch.color)) return err("VALIDATION", "invalid colour", "color");
      color = patch.color;
    }
    const next = { ...current, name, color };
    await this.db.put("contexts", next);
    return ok(next);
  }

  /** Delete a context, reassigning every referencing task atomically (RED-84). */
  async deleteContext(
    id: string,
    reassignTo: string | null,
    now: Date,
  ): Promise<Result<{ moved: number }>> {
    const tx = this.db.transaction(["contexts", "tasks", "provenance"], "readwrite");
    try {
      const target = await tx.objectStore("contexts").get(id);
      if (!target) {
        await tx.done;
        return err("NOT_FOUND", "context not found");
      }
      if (target.seeded === false && reassignTo != null) {
        const dest = await tx.objectStore("contexts").get(reassignTo);
        if (!dest) {
          await tx.done;
          return err("VALIDATION", "destination context not found", "reassignTo");
        }
      }
      const affected = await tx.objectStore("tasks").index("by_context").getAll(id);
      for (const task of affected) {
        await tx.objectStore("tasks").put({
          ...task,
          contextId: reassignTo,
          updatedAt: now.toISOString(),
        });
        const prov = await tx.objectStore("provenance").get(task.id);
        if (prov) {
          await tx.objectStore("provenance").put({
            ...prov,
            contextId: { source: "user", changedAt: now.toISOString(), interpretationId: null },
          });
        }
      }
      await tx.objectStore("contexts").delete(id);
      await tx.done;
      return ok({ moved: affected.length });
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* noop */
      }
      await tx.done.catch(() => {});
      return storageError(e);
    }
  }

  // ── Settings (UI-04) ───────────────────────────────────────────────────────
  async getSettings(): Promise<SettingsRecord | undefined> {
    return this.db.get("settings", "app");
  }

  async putSettings(patch: Partial<Omit<SettingsRecord, "key">>, now: Date): Promise<SettingsRecord> {
    const current = (await this.getSettings()) ?? DEFAULT_SETTINGS;
    const next: SettingsRecord = { ...current, ...patch, key: "app", updatedAt: now.toISOString() };
    await this.db.put("settings", next);
    return next;
  }

  private async pruneOperations(now: Date): Promise<void> {
    try {
      const cutoff = new Date(now.getTime() - OP_DEDUPE_MS).toISOString(); // the command clock, never wall time
      const tx = this.db.transaction("operations", "readwrite");
      let cursor = await tx.store.index("by_at").openCursor();
      while (cursor) {
        if (cursor.value.at < cutoff) await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    } catch {
      /* best effort */
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function stripTaskId(p: (TaskProvenance & { taskId: string }) | undefined): TaskProvenance {
  if (!p) throw new Error("provenance record missing");
  const { taskId: _omit, ...rest } = p;
  void _omit;
  return rest as TaskProvenance;
}

function mapReasons(events: string[]): HistoryReason[] {
  const out: HistoryReason[] = [];
  for (const e of events) {
    const r = eventToHistoryReason[e];
    if (r) out.push(r);
  }
  return out;
}

function conflict(): DomainError {
  return {
    code: "CONFLICT",
    message: "This task changed in another tab. Your edit was not saved.",
  };
}

function outcomeFor(e: DomainError): "conflict" | "validation" | "error" {
  if (e.code === "CONFLICT") return "conflict";
  if (e.code === "VALIDATION" || e.code === "NOT_FOUND") return "validation";
  return "error";
}

async function recordOp(
  tx: AnyWriteTx,
  ctx: CommandContext,
  outcome: "committed" | "conflict" | "validation" | "error",
  taskId: string | null,
  revision: number | null,
): Promise<void> {
  await tx.objectStore("operations").put({
    operationId: ctx.operationId,
    outcome,
    taskId,
    revision,
    at: ctx.now.toISOString(),
  });
}

function replayError(outcome: string): Result<never> {
  if (outcome === "conflict") return err("CONFLICT", "This task changed in another tab.");
  if (outcome === "validation") return err("VALIDATION", "The previous attempt was rejected.");
  return err("STORAGE_UNAVAILABLE", "The previous attempt did not complete.");
}

function storageError(e: unknown): Result<never> {
  const name = e instanceof Error ? e.name : "";
  if (name === "QuotaExceededError") {
    return err("QUOTA_EXCEEDED", "Browser storage is full. Free space or export a backup, then retry.");
  }
  return err("STORAGE_UNAVAILABLE", "The save did not complete. Your draft is kept — retry when ready.");
}

function quadrantOfSnapshot(s: HistorySnapshot): string {
  const impHigh = s.importance >= 0;
  const urgHigh = s.urgency >= 0;
  if (impHigh && urgHigh) return "do_now";
  if (impHigh) return "schedule";
  if (urgHigh) return "delegate";
  return "ignore";
}

export function effectiveCutoffMs(task: Task): number | null {
  return task.deadline ? deadlineCutoffMs(task.deadline) : null;
}
