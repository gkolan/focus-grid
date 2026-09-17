/**
 * Notification event detection + policy — contract section 47. Pure.
 * Only three event types, only on eligible active tasks, one attempt per
 * `taskId + deadlineRevision + eventType`. No guarantees about OS delivery.
 */
import type { PriorityResult } from "./priority";
import type { Task } from "./task";

export type NotificationEventType = "do_now" | "deadline_approaching" | "deadline_passed";

export interface NotificationEvent {
  key: string; // taskId + deadlineRevision + eventType
  taskId: string;
  deadlineRevision: number;
  type: NotificationEventType;
  focusScore: number;
}

export const eventKey = (taskId: string, deadlineRevision: number, type: NotificationEventType) =>
  `${taskId}::${deadlineRevision}::${type}`;

/** A task Focus/notifications may nudge about right now (47.2). */
export function isNotificationEligible(task: Task, p: PriorityResult, now: Date): boolean {
  if (task.status !== "active") return false;
  if (p.needsReview) return false;
  if (task.startAt != null && Date.parse(task.startAt) > now.getTime()) return false;
  return true;
}

/**
 * Detect events from one task's before → after state across a recalculation pass.
 * `before` may be null (task just entered scope / just created — no alert on
 * baseline). Movement into Do Now via an urgency pin does NOT count (47.1).
 */
export function detectEvents(
  task: Task,
  before: PriorityResult | null,
  after: PriorityResult,
  now: Date,
  focusScore: number,
): NotificationEvent[] {
  if (!isNotificationEligible(task, after, now)) return [];
  if (before == null) return []; // creation / import / new deadline revision = baseline only

  const out: NotificationEvent[] = [];
  const mk = (type: NotificationEventType): NotificationEvent => ({
    key: eventKey(task.id, task.deadlineRevision, type),
    taskId: task.id,
    deadlineRevision: task.deadlineRevision,
    type,
    focusScore,
  });

  // deadline passed: crossed the cutoff
  if (
    before.minutesToDeadline != null &&
    after.minutesToDeadline != null &&
    before.minutesToDeadline > 0 &&
    after.minutesToDeadline <= 0
  ) {
    out.push(mk("deadline_passed"));
  }

  // deadline approaching: crossed from > 24h remaining to <= 24h, still before cutoff
  if (
    before.minutesToDeadline != null &&
    after.minutesToDeadline != null &&
    before.minutesToDeadline > 1440 &&
    after.minutesToDeadline <= 1440 &&
    after.minutesToDeadline > 0
  ) {
    out.push(mk("deadline_approaching"));
  }

  // entered Do Now through automatic movement (not via a pin)
  if (
    task.userUrgencyOverride == null &&
    before.quadrant !== "do_now" &&
    after.quadrant === "do_now" &&
    after.automaticUrgency > before.automaticUrgency
  ) {
    out.push(mk("do_now"));
  }

  return out;
}

// ── Policy ───────────────────────────────────────────────────────────────────
const PRECEDENCE: Record<NotificationEventType, number> = {
  deadline_passed: 0,
  deadline_approaching: 1,
  do_now: 2,
};

/** Order eligible events: type precedence, then Focus score desc, then id (47.2). */
export function orderEvents(events: NotificationEvent[]): NotificationEvent[] {
  return [...events].sort(
    (a, b) =>
      PRECEDENCE[a.type] - PRECEDENCE[b.type] ||
      b.focusScore - a.focusScore ||
      (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0),
  );
}

/** HH:mm quiet-hours window, midnight-crossing aware, evaluated in the app zone. */
export function isWithinQuietHours(
  now: Date,
  quiet: { start: string; end: string } | null,
  timeZone: string,
): boolean {
  if (!quiet) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const cur = h * 60 + m;
  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

export const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60_000;
export const NOTIFICATION_HOURLY_CAP = 3;

/** Calm, guilt-free copy (UI-05 / RED-26). Generic by default; a title is appended only when the user opted in. */
export function notificationText(
  type: NotificationEventType,
  title: string | null,
): { body: string } {
  const base: Record<NotificationEventType, string> = {
    deadline_passed: "A task’s deadline has passed. Want to review it?",
    deadline_approaching: "A task is becoming time-sensitive.",
    do_now: "A task moved into Do Now.",
  };
  return { body: title ? `${base[type]} — ${title}` : base[type] };
}
