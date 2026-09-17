/**
 * IndexedDB schema — contract 46.1. Versioned from the first release.
 * Sole task authority: no server task DB, no volatile fallback.
 */
import type { DBSchema } from "idb";
import type { Context, TaskProvenance, Task } from "@/domain/task";
import type { HistorySnapshot } from "@/domain/history";
import type { PriorityTuning } from "@/domain/config";
import type { Recurrence } from "@/domain/task";

import type { CalendarFeed } from "@/domain/feeds";

export const DB_NAME = "focusgrid";
export const DB_VERSION = 1;

export interface SettingsRecord {
  key: "app";
  timeZone: string | null; // null = use device zone
  theme: "system" | "light" | "dark";
  sidebarPinned: boolean;
  notificationsEnabled: boolean;
  notificationTitles: boolean;
  quietHours: { start: string; end: string } | null;
  updatedAt: string;
  // Optional so older records load unchanged.
  language?: "en" | "es" | "de" | "fr";
  priorityTuning?: PriorityTuning | null;
  webhookUrl?: string | null;
  pushEnabled?: boolean;
  templates?: TaskTemplate[];
  calendarFeeds?: CalendarFeed[];
}

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  notes: string;
  estimatedMinutes: number | null;
  contextId: string | null;
  recurrence: Recurrence | null;
  tags: string[];
}

export interface OperationRecord {
  operationId: string;
  outcome: "committed" | "conflict" | "validation" | "error";
  taskId: string | null;
  revision: number | null;
  at: string; // ISO; pruned after 24h
}

export interface EventClaimRecord {
  key: string; // taskId + deadlineRevision + eventType
  taskId: string;
  eventType: "do_now" | "deadline_approaching" | "deadline_passed" | "summary";
  deadlineRevision: number;
  claimedAt: string;
  delivered: "pending" | "delivered" | "failed" | "suppressed";
  deliveredAt: string | null;
  suppressReason: string | null;
  /** for the in-app feed */
  body: string;
}

export interface InterpretationRecord {
  id: string;
  taskId: string;
  provider: string;
  model: string | null;
  schemaVersion: "1";
  at: string;
  acceptedFields: Record<string, { confidence: number | null; rationale: string | null }>;
}

export interface HistoryMetaRecord {
  taskId: string;
  omittedCount: number;
  omittedThroughSequence: number | null;
  omittedThroughDate: string | null;
}

export interface FocusGridDB extends DBSchema {
  tasks: {
    key: string;
    value: Task;
    indexes: { by_status: string; by_context: string };
  };
  provenance: { key: string; value: TaskProvenance & { taskId: string } };
  contexts: { key: string; value: Context };
  history: {
    key: [string, number];
    value: HistorySnapshot;
    indexes: { by_task: string };
  };
  interpretations: { key: string; value: InterpretationRecord; indexes: { by_task: string } };
  historyMeta: { key: string; value: HistoryMetaRecord };
  settings: { key: string; value: SettingsRecord };
  operations: { key: string; value: OperationRecord; indexes: { by_at: string } };
  eventClaims: { key: string; value: EventClaimRecord; indexes: { by_task: string } };
}

export const OP_DEDUPE_MS = 24 * 60 * 60 * 1000;
