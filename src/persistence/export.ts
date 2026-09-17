/**
 * Versioned export envelope + consistent read snapshot — contract 46.3, RED-123.
 * Excludes credentials, runtime caches, pending requests, drafts, focus session,
 * and notification delivery claims. Import/restore is step 10; this serializer
 * ships at step 03 so an early backup is real.
 */
import type { IDBPDatabase } from "idb";
import type { Context, TaskProvenance, Task } from "@/domain/task";
import type { HistorySnapshot } from "@/domain/history";
import type { FocusGridDB, InterpretationRecord } from "./schema";

export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportEnvelope {
  format: "focusgrid-export";
  schemaVersion: number;
  exportedAt: string;
  tasks: Task[];
  provenance: Array<TaskProvenance & { taskId: string }>;
  contexts: Context[];
  history: HistorySnapshot[];
  interpretations: InterpretationRecord[];
  settings: {
    timeZone: string | null;
    theme: "system" | "light" | "dark";
    quietHours: { start: string; end: string } | null;
    notificationsEnabled: boolean;
  } | null;
}

export async function exportSnapshot(
  db: IDBPDatabase<FocusGridDB>,
  now: Date,
): Promise<ExportEnvelope> {
  // One readonly transaction => a consistent snapshot even under concurrent writes.
  const tx = db.transaction(
    ["tasks", "provenance", "contexts", "history", "interpretations", "settings"],
    "readonly",
  );
  const [tasks, provenance, contexts, history, interpretations, settingsRec] = await Promise.all([
    tx.objectStore("tasks").getAll(),
    tx.objectStore("provenance").getAll(),
    tx.objectStore("contexts").getAll(),
    tx.objectStore("history").getAll(),
    tx.objectStore("interpretations").getAll(),
    tx.objectStore("settings").get("app"),
  ]);
  await tx.done;

  return {
    format: "focusgrid-export",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    tasks,
    provenance,
    contexts,
    history,
    interpretations,
    settings: settingsRec
      ? {
          timeZone: settingsRec.timeZone,
          theme: settingsRec.theme,
          quietHours: settingsRec.quietHours,
          notificationsEnabled: settingsRec.notificationsEnabled,
        }
      : null,
  };
}

export function serializeExport(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}
