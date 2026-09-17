/**
 * Exact priority engine. Pure: no persistence,
 * network, randomness, logging, or clock reads. `now` is injected; a whole
 * recalculation pass uses one captured instant.
 */
import { PRIORITY_CONFIG, type PriorityConfig } from "./config";
import { deadlineCutoffMs, minutesToDeadline } from "./deadline";
import type { Quadrant, Task } from "./task";

export interface PriorityResult {
  urgency: number;
  importance: number;
  automaticUrgency: number;
  deadlinePressure: number;
  effortPressure: number;
  overduePressure: number;
  remainingMinutes: number | null;
  minutesToDeadline: number | null;
  overdue: boolean;
  needsReview: boolean;
  trendReferenceAt: string;
  timePressureDelta: number;
  quadrant: Quadrant;
  engineVersion: "1.0";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Deadline-pressure knots ordered by ascending minutes-to-deadline (41.3).
const KNOTS: ReadonlyArray<[number, number]> = [
  [0, 1],
  [1_440, 0.8],
  [4_320, 0.5],
  [10_080, 0.25],
  [20_160, 0],
];

export function deadlinePressure(t: number): number {
  if (t <= KNOTS[0][0]) return KNOTS[0][1];
  const last = KNOTS[KNOTS.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const [a, pa] = KNOTS[i];
    const [b, pb] = KNOTS[i + 1];
    if (t >= a && t <= b) {
      const s = clamp((t - a) / (b - a), 0, 1);
      const smooth = s * s * (3 - 2 * s);
      return pa + (pb - pa) * smooth;
    }
  }
  return last[1];
}

/** Remaining effort in minutes (41.4). `null` estimate ⇒ `null` (never 0). */
export function remainingMinutes(task: Pick<Task, "estimatedMinutes" | "progress">): number | null {
  return task.estimatedMinutes == null
    ? null
    : task.estimatedMinutes * (1 - task.progress);
}

/** The pure coordinate core: effective urgency at a given instant, no trend wrapper. */
function coordinateCore(
  task: Task,
  nowMs: number,
  config: PriorityConfig,
): {
  automaticUrgency: number;
  urgency: number;
  deadlinePressure: number;
  effortPressure: number;
  overduePressure: number;
  t: number | null;
} {
  if (task.deadline == null) {
    const automaticUrgency = task.baseUrgency;
    return {
      automaticUrgency,
      urgency: task.userUrgencyOverride?.value ?? automaticUrgency,
      deadlinePressure: 0,
      effortPressure: 0,
      overduePressure: 0,
      t: null,
    };
  }
  const cutoff = deadlineCutoffMs(task.deadline);
  // Completed tasks keep the urgency they had when finished; otherwise every done
  // task drifts to the same saturated value and stacks in one column.
  if (task.status === "completed" && task.completedAt) nowMs = Math.min(nowMs, Date.parse(task.completedAt));
  const t = (cutoff - nowMs) / 60_000;
  const dp = deadlinePressure(t);
  const rem = remainingMinutes(task);
  const ep = rem == null ? 0 : clamp(rem / Math.max(t, 1), 0, 1);
  const op = clamp(Math.max(-t, 0) / config.overdueSaturationMinutes, 0, 1);
  const automaticUrgency = clamp(
    2 *
      (config.deadlineWeight * dp +
        config.effortWeight * ep +
        config.overdueWeight * op) -
      1,
    -1,
    1,
  );
  return {
    automaticUrgency,
    urgency: task.userUrgencyOverride?.value ?? automaticUrgency,
    deadlinePressure: dp,
    effortPressure: ep,
    overduePressure: op,
    t,
  };
}

export function classify(importance: number, urgency: number): Quadrant {
  const impHigh = importance >= 0;
  const urgHigh = urgency >= 0;
  if (impHigh && urgHigh) return "do_now";
  if (impHigh) return "schedule";
  if (urgHigh) return "delegate";
  return "ignore";
}

export function calculatePriority(
  task: Task,
  now: Date,
  config: PriorityConfig = PRIORITY_CONFIG,
): PriorityResult {
  const nowMs = now.getTime();
  const core = coordinateCore(task, nowMs, config);

  const importance = task.userImportanceOverride?.value ?? task.baseImportance;
  const urgency = core.urgency;

  // Overdue / needsReview (41.7)
  let overdue = false;
  let needsReview = false;
  let minutesLeft: number | null = null;
  if (task.deadline != null) {
    minutesLeft = minutesToDeadline(task.deadline, now);
    const cutoff = deadlineCutoffMs(task.deadline);
    overdue = nowMs >= cutoff;
    if (overdue && (task.status === "active" || task.status === "blocked")) {
      const defaultThreshold = cutoff + config.staleAfterMinutes * 60_000;
      const reviewAfterMs = task.reviewAfter != null ? Date.parse(task.reviewAfter) : defaultThreshold;
      needsReview = nowMs >= Math.max(defaultThreshold, reviewAfterMs);
    }
  }

  // Stable time-pressure trend (41.6)
  const createdMs = Date.parse(task.createdAt);
  const refMs = Math.min(nowMs, Math.max(createdMs, nowMs - 24 * 60 * 60_000));
  const refCore = coordinateCore(task, refMs, config);
  const timePressureDelta = core.urgency - refCore.urgency;

  return {
    urgency,
    importance,
    automaticUrgency: core.automaticUrgency,
    deadlinePressure: core.deadlinePressure,
    effortPressure: core.effortPressure,
    overduePressure: core.overduePressure,
    remainingMinutes: remainingMinutes(task),
    minutesToDeadline: minutesLeft,
    overdue,
    needsReview,
    trendReferenceAt: new Date(refMs).toISOString(),
    timePressureDelta,
    quadrant: classify(importance, urgency),
    engineVersion: "1.0",
  };
}

// ── Descriptive labels (41.6) ────────────────────────────────────────────────
export type ImportanceLabel = "Low" | "Medium" | "High";
export type UrgencyLabel = "Critical" | "High" | "Rising" | "Stable";

export function importanceLabel(importance: number): ImportanceLabel {
  if (importance < -1 / 3) return "Low";
  if (importance < 1 / 3) return "Medium";
  return "High";
}

export function urgencyLabel(effUrgency: number, timePressureDelta: number): UrgencyLabel {
  if (effUrgency >= 0.8) return "Critical";
  if (effUrgency >= 0.4) return "High";
  if (timePressureDelta >= 0.05) return "Rising";
  return "Stable";
}

/** Recompute and fold the effective coordinates back onto a task record. */
export function withRecalculatedPriority(
  task: Task,
  now: Date,
  config: PriorityConfig = PRIORITY_CONFIG,
): { task: Task; priority: PriorityResult; changed: boolean } {
  const priority = calculatePriority(task, now, config);
  const changed =
    task.importance !== priority.importance ||
    task.urgency !== priority.urgency ||
    task.lastCalculatedAt !== now.toISOString();
  return {
    task: {
      ...task,
      importance: priority.importance,
      urgency: priority.urgency,
      lastCalculatedAt: now.toISOString(),
    },
    priority,
    changed,
  };
}
