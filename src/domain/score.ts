/**
 * Reusable task score — contract 44.2. Defined for every validated task,
 * independent of Focus eligibility. Grid label priority (45.2) and Focus
 * ranking (step 08) both reuse this. Pure.
 */
import type { PriorityResult } from "./priority";
import type { Task } from "./task";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function scoreTask(task: Task, p: PriorityResult): number {
  const i = (p.importance + 1) / 2;
  const u = (p.urgency + 1) / 2;
  const deadlineRisk = p.deadlinePressure;
  const completionOpportunity =
    p.remainingMinutes == null ? 0 : clamp(1 - p.remainingMinutes / 60, 0, 1);
  return 0.5 * i + 0.35 * u + 0.1 * deadlineRisk + 0.05 * completionOpportunity;
}

/**
 * Deterministic tiebreak ordering for a ranked list (44.2): descending score,
 * then earliest effective deadline (null last), then ascending createdAt, then
 * lexical id. Returns <0 if `a` ranks before `b`.
 */
export function compareRanked(
  a: { task: Task; score: number; cutoffMs: number | null },
  b: { task: Task; score: number; cutoffMs: number | null },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const ac = a.cutoffMs ?? Number.POSITIVE_INFINITY;
  const bc = b.cutoffMs ?? Number.POSITIVE_INFINITY;
  if (ac !== bc) return ac - bc;
  if (a.task.createdAt !== b.task.createdAt) {
    return a.task.createdAt < b.task.createdAt ? -1 : 1;
  }
  return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
}
