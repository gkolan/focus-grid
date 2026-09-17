/**
 * Focus session state — contract 44.3. Tab-local, survives React remounts /
 * navigation (module singleton), resets on reload / new tab. Not persisted, not
 * exported. Start pins a task; Skip adds to a set; neither changes task data.
 */
import type { DueWindowFilter } from "@/domain/focus";
export interface FocusSessionState {
  startedTaskId: string | null;
  runningSince: number | null; // epoch ms while the started task's timer runs
  skipped: Set<string>;
  contextFilter: Set<string> | null;
  due: DueWindowFilter | null;
}

const session: FocusSessionState = {
  startedTaskId: null,
  runningSince: null,
  skipped: new Set(),
  contextFilter: null,
  due: null,
};

export function getFocusSession(): FocusSessionState {
  return session;
}

export function startFocus(taskId: string, now: number): void {
  session.startedTaskId = taskId;
  session.runningSince = now;
}
export function pauseFocus(): void {
  session.runningSince = null;
}
export function clearStartedFocus(): void {
  session.startedTaskId = null;
  session.runningSince = null;
}
export function skipFocus(taskId: string): void {
  session.skipped.add(taskId);
  if (session.startedTaskId === taskId) clearStartedFocus();
}
export function resetSkipped(): void {
  session.skipped.clear();
}
export function setFocusContextFilter(ids: string[] | null, due: DueWindowFilter | null = null): void {
  session.contextFilter = ids && ids.length ? new Set(ids) : null;
  session.due = due;
}

/** Test helper — reset the singleton between cases. */
export function __resetFocusSession(): void {
  clearStartedFocus();
  session.skipped.clear();
  session.contextFilter = null;
  session.due = null;
}
