import type { Deadline } from "@/domain/task";
import type { PriorityResult } from "@/domain/priority";
import { importanceLabel, urgencyLabel } from "@/domain/priority";

export function deadlineText(deadline: Deadline | null, p: PriorityResult, displayZone: string): string {
  if (!deadline) return "No deadline";
  if (deadline.kind === "date") {
    const d = new Date(deadline.date + "T12:00:00Z");
    const nice = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return p.overdue ? `Overdue — was due ${nice}` : `Due ${nice} (${deadline.timeZone})`;
  }
  const nice = new Date(deadline.at).toLocaleString(undefined, {
    timeZone: displayZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return p.overdue ? `Overdue — was due ${nice}` : `Due ${nice}`;
}

export function remainingEffortText(p: PriorityResult): string {
  if (p.remainingMinutes == null) return "Estimate unknown";
  const mins = Math.ceil(p.remainingMinutes);
  if (mins < 60) return `~${mins} min remaining`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `~${h}h ${m}m remaining` : `~${h}h remaining`;
}

/** "0 min", "45 min", "1h 20m" — for time spent. */
export function minutesText(minutes: number): string {
  const m = Math.floor(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

export function labelText(p: PriorityResult): string {
  return `${importanceLabel(p.importance)} importance · ${urgencyLabel(p.urgency, p.timePressureDelta)} urgency`;
}

export function statusText(status: string, needsReview: boolean, deferred: boolean): string | null {
  if (status === "blocked") return "Blocked";
  if (needsReview) return "Needs review";
  if (deferred) return "Starts later";
  return null;
}

export function detectZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
