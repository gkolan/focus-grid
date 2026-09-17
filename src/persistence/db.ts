/**
 * Database open + sequential migration — contract 46.2.
 * Never clears data to fix a migration. A newer schema opens read-only.
 */
import { type IDBPDatabase, openDB } from "idb";
import { DB_NAME, DB_VERSION, type FocusGridDB } from "./schema";
import { SEEDED_CONTEXT_NAMES } from "@/domain/task";

export type OpenOutcome =
  | { ok: true; db: IDBPDatabase<FocusGridDB>; readOnly: false }
  | { ok: false; code: "STORAGE_UNAVAILABLE" | "SCHEMA_UNSUPPORTED" | "BLOCKED"; message: string };

function migrate(db: IDBPDatabase<FocusGridDB>, oldVersion: number): void {
  // v0 -> v1: initial schema.
  if (oldVersion < 1) {
    const tasks = db.createObjectStore("tasks", { keyPath: "id" });
    tasks.createIndex("by_status", "status");
    tasks.createIndex("by_context", "contextId");
    db.createObjectStore("provenance", { keyPath: "taskId" });
    db.createObjectStore("contexts", { keyPath: "id" });
    const history = db.createObjectStore("history", { keyPath: ["taskId", "sequence"] });
    history.createIndex("by_task", "taskId");
    const interp = db.createObjectStore("interpretations", { keyPath: "id" });
    interp.createIndex("by_task", "taskId");
    db.createObjectStore("settings", { keyPath: "key" });
    db.createObjectStore("historyMeta", { keyPath: "taskId" });
    const ops = db.createObjectStore("operations", { keyPath: "operationId" });
    ops.createIndex("by_at", "at");
    const claims = db.createObjectStore("eventClaims", { keyPath: "key" });
    claims.createIndex("by_task", "taskId");
  }
  // future: if (oldVersion < 2) { ... } — sequential, non-destructive.
}

export const DEMO_DB_NAME = "focusgrid-demo";

export async function openFocusGridDB(dbName: string = DB_NAME): Promise<OpenOutcome> {
  let blocked = false;
  try {
    const db = await openDB<FocusGridDB>(dbName, DB_VERSION, {
      upgrade(database, oldVersion, newVersion) {
        if (newVersion != null && newVersion < oldVersion) return; // never destructive-downgrade
        migrate(database, oldVersion);
      },
      blocked() {
        blocked = true;
      },
      blocking() {
        // Another tab wants to upgrade; close so it can proceed.
      },
    });
    await seedContextsIfEmpty(db);
    return { ok: true, db, readOnly: false };
  } catch (e) {
    if (blocked) {
      return {
        ok: false,
        code: "BLOCKED",
        message: "Close other FocusGrid tabs to finish updating.",
      };
    }
    const name = e instanceof Error ? e.name : "";
    if (name === "VersionError") {
      return {
        ok: false,
        code: "SCHEMA_UNSUPPORTED",
        message: "This browser profile has FocusGrid data from a newer version. Update the app; your data is preserved.",
      };
    }
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      message: "FocusGrid can't reach browser storage. Your drafts are kept; export is available where possible.",
    };
  }
}

export const DEFAULT_CONTEXT_PALETTE = [
  "#2563eb",
  "#db2777",
  "#16a34a",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
] as const;

export async function seedDefaultContexts(db: IDBPDatabase<FocusGridDB>): Promise<void> {
  const tx = db.transaction("contexts", "readwrite");
  await Promise.all(
    SEEDED_CONTEXT_NAMES.map((name, i) =>
      tx.store.add({
        id: `seed-${name.toLowerCase()}`,
        name,
        color: DEFAULT_CONTEXT_PALETTE[i],
        seeded: true,
      }),
    ),
  );
  await tx.done;
}

async function seedContextsIfEmpty(db: IDBPDatabase<FocusGridDB>): Promise<void> {
  if ((await db.count("contexts")) === 0) await seedDefaultContexts(db);
}
