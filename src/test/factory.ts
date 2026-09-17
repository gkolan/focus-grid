import type { Deadline, TaskProvenance, TaskRecord, Task } from "@/domain/task";

export const T0 = "2026-09-10T12:00:00.000Z";

const defaultProv: TaskProvenance = Object.fromEntries(
  (
    [
      "title",
      "notes",
      "deadline",
      "startAt",
      "estimatedMinutes",
      "contextId",
      "baseImportance",
      "baseUrgency",
    ] as const
  ).map((f) => [f, { source: "default", changedAt: T0, interpretationId: null }]),
) as TaskProvenance;

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? "t1",
    revision: 1,
    title: "Test task",
    notes: "",
    status: "active",
    progress: 0,
    progressSource: "binary",
    progressBeforeCompletion: null,
    deadline: null,
    deadlineRevision: 1,
    startAt: null,
    estimatedMinutes: null,
    contextId: null,
    baseImportance: 0,
    baseUrgency: -0.6,
    userImportanceOverride: null,
    userUrgencyOverride: null,
    importance: 0,
    urgency: -0.6,
    reviewAfter: null,
    archivedFrom: null,
    blockedReason: null,
    createdAt: T0,
    updatedAt: T0,
    lastUserEditedAt: T0,
    completedAt: null,
    lastCalculatedAt: T0,
    engineVersion: "1.0",
    ...overrides,
  };
}

export function record(overrides: Partial<Task> = {}): TaskRecord {
  return { task: task(overrides), provenance: { ...defaultProv } };
}

/** An instant deadline `minutes` from the given `now`. */
export function deadlineIn(now: Date, minutes: number): Deadline {
  return {
    kind: "instant",
    at: new Date(now.getTime() + minutes * 60_000).toISOString(),
    timeZone: "UTC",
  };
}
