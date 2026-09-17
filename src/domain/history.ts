/**
 * Meaningful-history policy — contract 42.3. Pure. Persistence owns retention;
 * this owns "is this snapshot worth appending?".
 */
import { PRIORITY_CONFIG } from "./config";
import type { PriorityResult } from "./priority";

export type HistoryReason =
  | "created"
  | "override_set"
  | "override_reset"
  | "deadline_changed"
  | "progress_changed"
  | "ai_priority_accepted"
  | "quadrant_changed"
  | "critical_changed"
  | "review_changed"
  | "time_pressure";

export interface HistorySnapshot {
  taskId: string;
  sequence: number;
  taskRevision: number;
  timestamp: string;
  importance: number;
  urgency: number;
  automaticUrgency: number;
  deadlinePressure: number;
  effortPressure: number;
  overduePressure: number;
  reason: HistoryReason[];
  engineVersion: string;
  importancePinned: boolean;
  urgencyPinned: boolean;
}

/** Human-edit reasons that always force a snapshot regardless of coordinate delta. */
const FORCED: ReadonlySet<HistoryReason> = new Set([
  "created",
  "override_set",
  "override_reset",
  "deadline_changed",
  "progress_changed",
  "ai_priority_accepted",
]);

/**
 * Decide whether to append a snapshot given the last *meaningful* one.
 * Time-only motion appends when either axis moved ≥ 0.05 from that baseline
 * (cumulative drift, not per-heartbeat).
 */
export function shouldSnapshot(
  current: Pick<PriorityResult, "importance" | "urgency" | "quadrant"> & {
    critical: boolean;
    needsReview: boolean;
  },
  reasons: HistoryReason[],
  lastMeaningful: HistorySnapshot | null,
  lastFlags: { quadrant: string; critical: boolean; needsReview: boolean } | null,
): { append: boolean; reasons: HistoryReason[] } {
  const out = new Set(reasons.filter((r) => FORCED.has(r)));

  if (lastFlags) {
    if (lastFlags.quadrant !== current.quadrant) out.add("quadrant_changed");
    if (lastFlags.critical !== current.critical) out.add("critical_changed");
    if (lastFlags.needsReview !== current.needsReview) out.add("review_changed");
  }

  if (!lastMeaningful) {
    out.add("created");
    return { append: true, reasons: [...out] };
  }

  const di = Math.abs(current.importance - lastMeaningful.importance);
  const du = Math.abs(current.urgency - lastMeaningful.urgency);
  if (di >= PRIORITY_CONFIG.meaningfulAxisDelta || du >= PRIORITY_CONFIG.meaningfulAxisDelta) {
    out.add("time_pressure");
  }

  return { append: out.size > 0, reasons: [...out] };
}

export const HISTORY_RETENTION = 500; // initial + newest 499 (42.3)
