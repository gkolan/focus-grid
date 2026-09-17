/**
 * Focus recommendation — contract section 44. Pure. Eligibility gates only which
 * tasks Focus may recommend; `scoreTask` (score.ts) is shared with the grid and
 * is defined for every task regardless of eligibility.
 */
import { deadlineCutoffMs } from "./deadline";
import { importanceLabel, type PriorityResult, urgencyLabel } from "./priority";
import { compareRanked, scoreTask } from "./score";
import type { Task } from "./task";

export interface FocusSessionView {
  skipped: ReadonlySet<string>;
  contextFilter: ReadonlySet<string> | null; // null = all contexts
  /** (start, end] ms — only tasks due in this window are eligible (time-range bar). start is -Infinity to keep overdue. */
  due?: DueWindowFilter | null;
  /** ids of unfinished tasks — a task whose blocker is here is not actionable (dependencies). */
  openIds?: ReadonlySet<string>;
}

/** waiting on an unfinished blocker, or delegated to someone else. */
export function isWaiting(task: Task, openIds?: ReadonlySet<string>): boolean {
  if (task.assignee) return true;
  return !!openIds && (task.blockedByIds ?? []).some((id) => openIds.has(id));
}

export interface Candidate {
  task: Task;
  priority: PriorityResult;
}

export interface RankedCandidate extends Candidate {
  score: number;
  cutoffMs: number | null;
}

export interface DueWindowFilter {
  start: number;
  end: number;
  /** the window holds today: unfinished overdue work from before it stays visible; completed work does not */
  includeOverdue?: boolean;
}

/** Deadline cutoff within (start, end]; undated tasks are "whenever" and always qualify. */
export function isDueIn(task: Task, w: DueWindowFilter): boolean {
  if (task.deadline == null) return true;
  const c = deadlineCutoffMs(task.deadline);
  if (c > w.end) return false;
  return c > w.start || (!!w.includeOverdue && task.status !== "completed");
}

/** 44.1 — a task Focus is allowed to recommend right now. */
export function isFocusEligible(
  task: Task,
  priority: PriorityResult,
  now: Date,
  session: FocusSessionView,
): boolean {
  if (task.status !== "active") return false; // excludes blocked, completed, archived
  if (priority.needsReview) return false;
  if (task.startAt != null && Date.parse(task.startAt) > now.getTime()) return false; // deferred
  if (isWaiting(task, session.openIds)) return false;
  if (session.skipped.has(task.id)) return false;
  if (session.contextFilter && !session.contextFilter.has(task.contextId ?? "__uncategorized__")) {
    return false;
  }
  if (session.due != null && !isDueIn(task, session.due)) return false;
  return true;
}

/** 44.2 — exact deterministic ranking. Full numeric precision; no randomness. */
export function rankFocus(candidates: Candidate[]): RankedCandidate[] {
  return candidates
    .map((c) => ({
      ...c,
      score: scoreTask(c.task, c.priority),
      cutoffMs: c.task.deadline ? deadlineCutoffMs(c.task.deadline) : null,
    }))
    .sort(compareRanked);
}

export type FocusEmptyReason =
  | "empty_database"
  | "no_actionable"
  | "all_skipped"
  | "filter_empty";

/**
 * Resolve the current Focus recommendation, honouring a pinned started task
 * (RED-63) and reporting a precise empty reason when there is nothing to show.
 */
export function resolveFocus(
  allCandidates: Candidate[],
  now: Date,
  session: FocusSessionView & { startedTaskId: string | null },
  totalTaskCount: number,
): {
  current: RankedCandidate | null;
  ranked: RankedCandidate[];
  emptyReason: FocusEmptyReason | null;
  recommendationChanged: boolean;
} {
  const eligible = allCandidates.filter((c) => isFocusEligible(c.task, c.priority, now, session));
  const ranked = rankFocus(eligible);

  // Pinned started task keeps focus while it is still eligible.
  const started =
    session.startedTaskId != null
      ? ranked.find((r) => r.task.id === session.startedTaskId) ?? null
      : null;
  const top = ranked[0] ?? null;
  const current = started ?? top;
  const recommendationChanged = started != null && top != null && top.task.id !== started.task.id;

  let emptyReason: FocusEmptyReason | null = null;
  if (current == null) {
    if (totalTaskCount === 0) emptyReason = "empty_database";
    else if (session.contextFilter && anyContextEligibleWithoutFilter(allCandidates, now, session)) {
      emptyReason = "filter_empty";
    } else if (
      session.skipped.size > 0 &&
      allCandidates.some(
        (c) =>
          c.task.status === "active" &&
          !c.priority.needsReview &&
          !(c.task.startAt != null && Date.parse(c.task.startAt) > now.getTime()) &&
          session.skipped.has(c.task.id),
      )
    ) {
      emptyReason = "all_skipped";
    } else {
      emptyReason = "no_actionable";
    }
  }

  return { current, ranked, emptyReason, recommendationChanged };
}

function anyContextEligibleWithoutFilter(
  all: Candidate[],
  now: Date,
  session: FocusSessionView & { startedTaskId: string | null },
): boolean {
  const noFilter: FocusSessionView = { skipped: session.skipped, contextFilter: null, openIds: session.openIds, due: session.due };
  return all.some((c) => isFocusEligible(c.task, c.priority, now, noFilter));
}

/** 44.2/44.4 — rationale from the same inputs; never asserts "enough time". */
export function focusRationale(task: Task, p: PriorityResult): string[] {
  const out: string[] = [];
  out.push(`${importanceLabel(p.importance)} importance`);
  out.push(`${urgencyLabel(p.urgency, p.timePressureDelta)} urgency`);
  if (task.userUrgencyOverride) {
    out.push(
      `Urgency is pinned by hand at ${p.urgency.toFixed(2)}; the automatic value is ${p.automaticUrgency.toFixed(2)}.`,
    );
  }
  if (task.userImportanceOverride) out.push("Importance is pinned by hand.");
  if (p.minutesToDeadline != null) {
    out.push(
      p.overdue
        ? "The deadline has passed."
        : p.deadlinePressure >= 0.5
          ? "Deadline pressure is high."
          : "The deadline is still some way off.",
    );
  }
  if (p.remainingMinutes == null) out.push("Estimate unknown — remaining effort is not known.");
  else out.push(`About ${Math.ceil(p.remainingMinutes)} minute(s) of work remain.`);
  return out;
}
