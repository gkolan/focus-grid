import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "@/test/unwrap";
import { block, complete, setAxisOverride } from "@/domain/commands";
import { openFocusGridDB } from "./db";
import { TaskRepository, type CommandContext } from "./repository";
import { exportSnapshot, serializeExport } from "./export";
import { validateImportFile } from "./import";

const NOW = new Date("2026-09-10T12:00:00.000Z");
let seq = 0;
const ctx = (o: Partial<CommandContext> = {}): CommandContext => ({ operationId: `op-${++seq}`, now: NOW, ...o });

async function repo() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return { repo: new TaskRepository(o.db), db: o.db };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("import validation (46.3)", () => {
  it("RED-77: prototype keys are rejected before any write", () => {
    const bad = '{"format":"focusgrid-export","schemaVersion":1,"exportedAt":"x","tasks":[{"__proto__":{}}],"provenance":[],"contexts":[],"history":[],"interpretations":[]}';
    const r = validateImportFile(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects non-JSON and non-FocusGrid files", () => {
    expect(validateImportFile("not json").ok).toBe(false);
    expect(validateImportFile('{"hello":"world"}').ok).toBe(false);
  });

  it("newer schemaVersion → SCHEMA_UNSUPPORTED", () => {
    const r = validateImportFile(
      JSON.stringify({ format: "focusgrid-export", schemaVersion: 99, exportedAt: "x", tasks: [], provenance: [], contexts: [], history: [], interpretations: [] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SCHEMA_UNSUPPORTED");
  });

  it("RED-76: one invalid task row among many rejects the whole file", async () => {
    const { repo: r, db } = await repo();
    for (let i = 0; i < 5; i++) unwrap(await r.create({ id: `t${i}`, title: `Task ${i}` }, ctx()));
    const env = await exportSnapshot(db, NOW);
    // corrupt one row
    (env.tasks[2] as { progress: unknown }).progress = 5; // out of [0,1]
    const parsed = validateImportFile(serializeExport(env));
    expect(parsed.ok).toBe(false);
  });

  it("RED-77: a task pointing at a context absent from the file is rejected", async () => {
    const { repo: r, db } = await repo();
    const contexts = await r.listContexts();
    unwrap(await r.create({ id: "t1", title: "T", contextId: contexts[0].id }, ctx()));
    const env = await exportSnapshot(db, NOW);
    env.contexts = []; // drop the context but keep the reference
    expect(validateImportFile(serializeExport(env)).ok).toBe(false);
  });
});

describe("Add as copies (46.3)", () => {
  it("RED-94: semantic round-trip with regenerated ids — Unicode, zones, overrides, history", async () => {
    const src = await repo();
    const created = unwrap(
      await src.repo.create(
        {
          id: "orig-1",
          title: "Café résumé — 履歴書 ☕",
          notes: "line 1\nline 2",
          deadline: { kind: "date", date: "2026-12-01", timeZone: "Asia/Kolkata" },
          estimatedMinutes: 90,
        },
        ctx(),
      ),
    );
    unwrap(
      await src.repo.mutate("orig-1", ctx({ expectedRevision: created.revision }), (rec, _k, now) =>
        setAxisOverride(rec, "importance", 0.4, "editor", now),
      ),
    );
    unwrap(await src.repo.create({ id: "orig-2", title: "Done thing" }, ctx()));
    unwrap(await src.repo.mutate("orig-2", ctx({ expectedRevision: 1 }), (rec, _k, now) => complete(rec, now)));
    const backup = serializeExport(await exportSnapshot(src.db, NOW));

    // fresh profile
    globalThis.indexedDB = new IDBFactory();
    const dest = await repo();
    const parsed = validateImportFile(backup);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const res = await dest.repo.importCopies(parsed.value, NOW);
    expect(res.ok).toBe(true);

    const tasks = await dest.repo.listTasks();
    expect(tasks).toHaveLength(2);
    const cafe = tasks.find((t) => t.task.title.startsWith("Café"))!;
    expect(cafe.task.id).not.toBe("orig-1"); // regenerated
    expect(cafe.task.deadline).toEqual({ kind: "date", date: "2026-12-01", timeZone: "Asia/Kolkata" });
    expect(cafe.task.notes).toBe("line 1\nline 2");
    expect(cafe.task.userImportanceOverride?.value).toBe(0.4);
    expect(cafe.provenance.baseImportance).toBeDefined();
    // completed task keeps its snapshot; active task history rebuilds
    const done = tasks.find((t) => t.task.status === "completed")!;
    expect((await dest.repo.historyFor(done.task.id)).length).toBeGreaterThan(0);
  });

  it("matches an existing context by name instead of duplicating it", async () => {
    const src = await repo();
    const work = (await src.repo.listContexts()).find((c) => c.name === "Work")!;
    unwrap(await src.repo.create({ id: "t1", title: "T", contextId: work.id }, ctx()));
    const backup = serializeExport(await exportSnapshot(src.db, NOW));

    globalThis.indexedDB = new IDBFactory();
    const dest = await repo();
    const parsed = validateImportFile(backup);
    if (!parsed.ok) throw new Error();
    const res = await dest.repo.importCopies(parsed.value, NOW);
    expect(res.ok && res.value.contextsAdded).toBe(0); // Work already exists
    const t = (await dest.repo.listTasks())[0];
    const destWork = (await dest.repo.listContexts()).find((c) => c.name === "Work")!;
    expect(t.task.contextId).toBe(destWork.id);
  });

  it("task cap is enforced without evicting existing data", async () => {
    const { repo: r, db } = await repo();
    unwrap(await r.create({ id: "keep", title: "Keep me" }, ctx()));
    // fake a huge file by cloning
    const env = await exportSnapshot(db, NOW);
    const one = env.tasks[0];
    const oneProv = env.provenance[0];
    env.tasks = Array.from({ length: 10_001 }, (_, i) => ({ ...one, id: `bulk-${i}` }));
    env.provenance = env.tasks.map((t) => ({ ...(oneProv as object), taskId: t.id })) as typeof env.provenance;
    env.history = [];
    const parsed = validateImportFile(serializeExport(env));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const res = await r.importCopies(parsed.value, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("QUOTA_EXCEEDED");
    expect((await r.listTasks()).length).toBe(1); // "keep" survived
  });
});

describe("delete all local data (46.5)", () => {
  it("RED-86: after delete-all a stale update of a removed id cannot recreate it", async () => {
    const { repo: r } = await repo();
    unwrap(await r.create({ id: "t1", title: "Secret" }, ctx()));
    await r.deleteAllLocalData();
    expect(await r.listTasks()).toHaveLength(0);
    // default contexts are re-seeded (first-run state)
    expect((await r.listContexts()).length).toBe(7);
    // stale edit
    const stale = await r.mutate("t1", ctx({ expectedRevision: 1 }), (rec, _k, now) => block(rec, now),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("NOT_FOUND");
    expect(await r.listTasks()).toHaveLength(0);
  });
});
