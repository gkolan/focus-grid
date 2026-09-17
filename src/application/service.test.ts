import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { FocusGridApp } from "./service";

const NOW = "2026-09-10T12:00:00.000Z";

async function makeApp(hooks = {}) {
  const outcome = await openFocusGridDB();
  if (!outcome.ok) throw new Error(outcome.code);
  const repo = new TaskRepository(outcome.db, undefined, hooks);
  return new FocusGridApp(repo, new FakeClock(NOW), outcome.db);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("FocusGridApp (step 04)", () => {
  it("UI-03: untouched importance leaves base 0 with default provenance; touched Medium pins to 0", async () => {
    const app = await makeApp();
    const a = await app.createManualTask({ title: "Untouched", importance: "untouched" });
    const b = await app.createManualTask({ title: "Pinned medium", importance: "medium" });
    expect(a.ok && b.ok).toBe(true);

    const views = await app.inbox();
    const untouched = views.find((v) => v.record.task.title === "Untouched")!;
    const pinned = views.find((v) => v.record.task.title === "Pinned medium")!;
    expect(untouched.record.task.userImportanceOverride).toBeNull();
    expect(untouched.record.provenance.baseImportance.source).toBe("default");
    expect(pinned.record.task.userImportanceOverride).toEqual(
      expect.objectContaining({ value: 0 }),
    );
  });

  it("importance Low/High map to -0.6 / +0.6 overrides", async () => {
    const app = await makeApp();
    await app.createManualTask({ title: "Lo", importance: "low" });
    await app.createManualTask({ title: "Hi", importance: "high" });
    const v = await app.inbox();
    expect(v.find((x) => x.record.task.title === "Lo")!.record.task.userImportanceOverride!.value).toBe(-0.6);
    expect(v.find((x) => x.record.task.title === "Hi")!.record.task.userImportanceOverride!.value).toBe(0.6);
  });

  it("RED-113: creation undo refuses after another edit and offers archive instead", async () => {
    const app = await makeApp();
    const created = await app.createManualTask({ title: "Oops", importance: "untouched" });
    if (!created.ok) throw new Error("create failed");
    // Simulate another tab editing it.
    const edited = await app.edit(created.value.id, created.value.revision, { title: "Kept" });
    expect(edited.ok).toBe(true);
    const undo = await app.undoCreate(created.value.id, created.value.revision);
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.error.code).toBe("CONFLICT");
    expect((await app.inbox()).some((v) => v.record.task.title === "Kept")).toBe(true);
  });

  it("undo removes the task when its creation revision still matches", async () => {
    const app = await makeApp();
    const created = await app.createManualTask({ title: "Gone", importance: "untouched" });
    if (!created.ok) throw new Error();
    const undo = await app.undoCreate(created.value.id, created.value.revision);
    expect(undo.ok).toBe(true);
    expect((await app.inbox()).length).toBe(0);
  });

  it("RED-84: deleting a context reassigns tasks atomically; tasks survive", async () => {
    const app = await makeApp();
    const ctx = await app.createContext("Renovations", "#123456");
    if (!ctx.ok) throw new Error();
    await app.createManualTask({ title: "Fix roof", contextId: ctx.value.id, importance: "untouched" });
    const del = await app.deleteContext(ctx.value.id, null);
    expect(del.ok && del.value.moved).toBe(1);
    const views = await app.inbox();
    expect(views).toHaveLength(1);
    expect(views[0].record.task.contextId).toBeNull();
    expect(views[0].contextName).toBe("Uncategorized");
    expect(views[0].record.provenance.contextId.source).toBe("user");
  });

  it("RED-109 search is NFC + case-insensitive substring over title and notes", async () => {
    const app = await makeApp();
    await app.createManualTask({ title: "Café planning", notes: "book venue", importance: "untouched" });
    expect((await app.inbox("CAFE")).length).toBe(0); // é vs e — not a fold, substring only
    expect((await app.inbox("café")).length).toBe(1);
    expect((await app.inbox("VENUE")).length).toBe(1); // notes match, case-insensitive
  });

  it("WAR-04-01: rushed editing — all committed values survive a reload", async () => {
    const app = await makeApp();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await app.createManualTask({ title: `Task ${i}`, importance: "untouched" });
      if (r.ok) ids.push(r.value.id);
    }
    const t0 = (await app.inbox()).find((v) => v.record.task.title === "Task 0")!;
    await app.edit(t0.record.task.id, t0.record.task.revision, {
      deadline: { kind: "date", date: "2026-09-20", timeZone: "UTC" },
    });
    const t1 = (await app.inbox()).find((v) => v.record.task.title === "Task 1")!;
    await app.complete(t1.record.task.id, t1.record.task.revision);
    const t1b = (await app.completed()).find((v) => v.record.task.title === "Task 1")!;
    await app.reopen(t1b.record.task.id, t1b.record.task.revision);
    const t2 = (await app.inbox()).find((v) => v.record.task.title === "Task 2")!;
    await app.archive(t2.record.task.id, t2.record.task.revision);

    // "Reload"
    const app2 = await makeApp();
    const inbox = await app2.inbox();
    expect(inbox.map((v) => v.record.task.title).sort()).toEqual(["Task 0", "Task 1", "Task 3", "Task 4"]);
    expect(inbox.find((v) => v.record.task.title === "Task 0")!.record.task.deadline).not.toBeNull();
    expect((await app2.archived()).map((v) => v.record.task.title)).toEqual(["Task 2"]);
  });

  it("WAR-04-02: disk full during a long draft — never reports saved, retry commits once", async () => {
    let boom = true;
    const app = await makeApp({
      beforeCommit: () => {
        if (boom) throw Object.assign(new Error("q"), { name: "QuotaExceededError" });
      },
    });
    const bigNotes = "x".repeat(9000);
    const first = await app.createManualTask({ title: "Long draft", notes: bigNotes, importance: "untouched" });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe("QUOTA_EXCEEDED");
    expect((await app.inbox()).length).toBe(0);

    boom = false;
    const retry = await app.createManualTask({ title: "Long draft", notes: bigNotes, importance: "untouched" });
    expect(retry.ok).toBe(true);
    expect((await app.inbox()).length).toBe(1);
  });
});
