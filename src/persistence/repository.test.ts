import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "@/test/unwrap";
import { block, patchTask, setAxisOverride } from "@/domain/commands";
import { openFocusGridDB } from "./db";
import { TaskRepository, type CommandContext } from "./repository";
import { exportSnapshot } from "./export";
import { DB_NAME } from "./schema";

const NOW = new Date("2026-09-10T12:00:00.000Z");
let opSeq = 0;
const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  operationId: `op-${++opSeq}`,
  now: NOW,
  ...over,
});

async function freshRepo(hooks = {}) {
  const outcome = await openFocusGridDB();
  if (!outcome.ok) throw new Error(outcome.code);
  return new TaskRepository(outcome.db, undefined, hooks);
}

beforeEach(() => {
  // Isolate each test with a brand-new IndexedDB.
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  globalThis.indexedDB.deleteDatabase(DB_NAME);
});

describe("persistence unit of work (42.2)", () => {
  it("seeds the 7 default contexts on a fresh store", async () => {
    const repo = await freshRepo();
    const contexts = await repo.listContexts();
    expect(contexts.map((c) => c.name).sort()).toEqual(
      ["Career", "Family", "Finance", "Health", "Home", "Personal", "Work"],
    );
  });

  it("create then reload preserves committed values + overrides", async () => {
    let repo = await freshRepo();
    const created = unwrap(await repo.create({ id: "t1", title: "Buy milk", baseImportance: 0.2 }, ctx()));
    unwrap(
      await repo.mutate("t1", ctx({ expectedRevision: created.revision }), (r, k, now) =>
        setAxisOverride(r, "urgency", 0, "editor", now),
      ),
    );

    // Reopen the database from "disk".
    repo = await freshRepo();
    const back = await repo.getTask("t1");
    expect(back?.task.title).toBe("Buy milk");
    expect(back?.task.baseImportance).toBe(0.2);
    expect(back?.task.userUrgencyOverride).toEqual(
      expect.objectContaining({ value: 0, source: "editor" }),
    );
    expect(back?.task.revision).toBe(2);
  });

  it("RED-71: replaying the same operationId yields one task, same result", async () => {
    const repo = await freshRepo();
    const op = ctx();
    const a = unwrap(await repo.create({ id: "t1", title: "Once" }, op));
    const b = unwrap(await repo.create({ id: "t1", title: "Once" }, op));
    expect(a.revision).toBe(b.revision);
    expect((await repo.listTasks()).length).toBe(1);
  });

  it("RED-80: two edits of the same revision — first commits, second conflicts", async () => {
    const repo = await freshRepo();
    const c = unwrap(await repo.create({ id: "t1", title: "T" }, ctx()));
    const first = await repo.mutate("t1", ctx({ expectedRevision: c.revision }), (r, k, now) =>
      patchTask(r, { title: "A" }, now, k),
    );
    const second = await repo.mutate("t1", ctx({ expectedRevision: c.revision }), (r, k, now) =>
      patchTask(r, { title: "B" }, now, k),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("CONFLICT");
    expect((await repo.getTask("t1"))?.task.title).toBe("A");
  });

  it("RED-79: a failure before commit rolls back task + history together", async () => {
    let boom = false;
    const repo = await freshRepo({
      beforeCommit: () => {
        if (boom) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      },
    });
    unwrap(await repo.create({ id: "t1", title: "Good" }, ctx()));
    boom = true;
    const failed = await repo.mutate("t1", ctx({ expectedRevision: 1 }), (r, k, now) =>
      patchTask(r, { title: "Never" }, now, k),
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("QUOTA_EXCEEDED");

    const back = await repo.getTask("t1");
    expect(back?.task.title).toBe("Good");
    expect(back?.task.revision).toBe(1);
    expect(await repo.historyFor("t1")).toHaveLength(1); // only the create snapshot
  });

  it("appends a meaningful history snapshot on create and on override", async () => {
    const repo = await freshRepo();
    const c = unwrap(await repo.create({ id: "t1", title: "T" }, ctx()));
    expect(await repo.historyFor("t1")).toHaveLength(1);
    unwrap(
      await repo.mutate("t1", ctx({ expectedRevision: c.revision }), (r, k, now) =>
        setAxisOverride(r, "importance", 0.8, "editor", now),
      ),
    );
    const h = await repo.historyFor("t1");
    expect(h).toHaveLength(2);
    expect(h[1].reason).toContain("override_set");
    expect(h[1].importance).toBe(0.8);
  });

  it("RED-123: export is a versioned, consistent snapshot of committed data", async () => {
    const repo = await freshRepo();
    unwrap(await repo.create({ id: "t1", title: "Café ☕ résumé" }, ctx()));
    const outcome = await openFocusGridDB();
    if (!outcome.ok) throw new Error(outcome.code);
    const env = await exportSnapshot(outcome.db, NOW);
    expect(env).toMatchObject({ format: "focusgrid-export", schemaVersion: 1 });
    expect(env.tasks[0].title).toBe("Café ☕ résumé");
    expect(env.contexts).toHaveLength(7);
    expect(Array.isArray(env.interpretations)).toBe(true);
    expect(JSON.stringify(env)).not.toMatch(/OPENAI|API_KEY|secret/i);
  });

  it("expectedRevision is required for existing-task commands", async () => {
    const repo = await freshRepo();
    unwrap(await repo.create({ id: "t1", title: "T" }, ctx()));
    const r = await repo.mutate("t1", ctx(), (rec, k, now) => block(rec, now));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("RED-82: a newer on-disk schema opens read-only, never destructive downgrade", async () => {
    // Simulate a future build having bumped the DB to v2.
    await new Promise<void>((resolve, reject) => {
      const req = globalThis.indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => req.result.createObjectStore("tasks", { keyPath: "id" });
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const outcome = await openFocusGridDB();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("SCHEMA_UNSUPPORTED");
      expect(outcome.message).toMatch(/preserved/i); // non-destructive, actionable
    }
    // The v2 store is still on disk — nothing was cleared.
    const check = await new Promise<string[]>((resolve) => {
      const req = globalThis.indexedDB.open(DB_NAME, 2);
      req.onsuccess = () => {
        const names = [...req.result.objectStoreNames];
        req.result.close();
        resolve(names);
      };
    });
    expect(check).toContain("tasks");
  });

  it("read-only recovery repository refuses writes", async () => {
    const outcome = await openFocusGridDB();
    if (!outcome.ok) throw new Error(outcome.code);
    const repo = new TaskRepository(outcome.db, undefined, {}, true);
    const r = await repo.create({ id: "x", title: "nope" }, ctx());
    expect(r.ok).toBe(false);
  });

  it("stale edit on a deleted task is NOT_FOUND, not a recreate", async () => {
    const repo = await freshRepo();
    const r = await repo.mutate("ghost", ctx({ expectedRevision: 1 }), (rec, k, now) => block(rec, now));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect((await repo.listTasks()).length).toBe(0);
  });
});
