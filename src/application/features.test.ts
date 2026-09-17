import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { unwrap } from "@/test/unwrap";
import { FocusGridApp } from "./service";
import { plannedReminders } from "./push";
import { dispatchWebhook, webhookPayload } from "./webhooks";

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

describe("FocusGridApp features", () => {
  it("completing a recurring task spawns the next occurrence", async () => {
    const app = await makeApp();
    const r = unwrap(await app.createManualTask({ title: "Water plants", importance: "untouched", deadline: { kind: "date", date: "2026-09-10", timeZone: "UTC" }, recurrence: { every: 3, unit: "day" } }));
    unwrap(await app.complete(r.id, r.revision));
    const open = await app.inbox();
    expect(open).toHaveLength(1);
    expect(open[0].record.task.deadline).toMatchObject({ date: "2026-09-13" });
    expect(open[0].record.task.recurrence).toEqual({ every: 3, unit: "day" });
  });

  it("project inherits the most urgent open child; blocked tasks leave Focus; undo reverts", async () => {
    const app = await makeApp();
    const parent = unwrap(await app.createManualTask({ title: "Project", importance: "untouched" }));
    unwrap(await app.createManualTask({ title: "Child", importance: "untouched", parentId: parent.id, deadline: { kind: "instant", at: "2026-09-10T13:00:00.000Z", timeZone: "UTC" } }));
    const views = await app.allViews();
    const pv = views.find((v) => v.record.task.id === parent.id)!;
    expect(pv.childCount).toBe(1);
    expect(pv.priority.urgency).toBeGreaterThan(-0.6); // base is -0.6; inherited from the child due in an hour

    const waiting = unwrap(await app.createManualTask({ title: "After project", importance: "untouched", blockedByIds: [parent.id] }));
    const f = await app.focus();
    expect(f.current?.record.task.id).not.toBe(waiting.id);
    expect((await app.inbox()).find((v) => v.record.task.id === waiting.id)!.blockerTitles).toEqual(["Project"]);

    unwrap(await app.edit(waiting.id, waiting.revision, { title: "Renamed" }));
    expect(app.canUndo()).toBe("After project");
    unwrap(await app.undoLast());
    expect((await app.inbox()).find((v) => v.record.task.id === waiting.id)!.record.task.title).toBe("After project");
  });

  it("bulk capture, #tag search, external import with contexts and parents", async () => {
    const app = await makeApp();
    const b = await app.captureBulk("- Buy milk\n2. Call mum\n\n", "UTC", false);
    expect(b).toEqual({ created: 2, failed: 0 });
    unwrap(await app.createManualTask({ title: "Tagged", importance: "untouched", tags: ["deep"] }));
    expect((await app.inbox("#deep")).map((v) => v.record.task.title)).toEqual(["Tagged"]);

    const rows = unwrap(app.previewExternalImport("csv", "title,context,due\nParent,Ops,2026-10-01\n", "UTC"));
    rows.push({ ...rows[0], title: "Kid", parentTitle: "Parent", deadline: null, contextName: null });
    const r = unwrap(await app.importExternal(rows));
    expect(r).toEqual({ tasksAdded: 2, contextsAdded: 1 });
    const kid = (await app.inbox()).find((v) => v.record.task.title === "Kid")!;
    expect(kid.parentTitle).toBe("Parent");
    expect((await app.contexts()).some((c) => c.name === "Ops")).toBe(true);
  });

  it("tuning changes coordinates and templates round-trip", async () => {
    const app = await makeApp();
    const t = unwrap(await app.createManualTask({ title: "Due soon", importance: "untouched", deadline: { kind: "instant", at: "2026-09-12T12:00:00.000Z", timeZone: "UTC" }, estimatedMinutes: 600 }));
    const before = (await app.allViews())[0].priority.urgency;
    await app.setTuning({ deadlineWeight: 0, effortWeight: 1, overdueWeight: 0 });
    const after = (await app.allViews())[0].priority.urgency;
    expect(after).not.toBeCloseTo(before);
    expect((await app.getSettings())?.priorityTuning?.effortWeight).toBe(1);
    void t;
    const tp = await app.saveTemplate({ name: "Weekly", title: "Review", notes: "", estimatedMinutes: 20, contextId: null, recurrence: { every: 1, unit: "week" }, tags: ["ops"] });
    expect((await app.templates()).map((x) => x.id)).toEqual([tp.id]);
    await app.deleteTemplate(tp.id);
    expect(await app.templates()).toEqual([]);
  });

  it("repository onEvents feeds webhooks with only the committed events", async () => {
    const seen: string[][] = [];
    const app = await makeApp({ onEvents: (_t: unknown, ev: string[]) => seen.push(ev) });
    const r = unwrap(await app.createManualTask({ title: "Hook", importance: "untouched" }));
    unwrap(await app.complete(r.id, r.revision));
    expect(seen).toEqual([["created"], ["completed"]]);
    const fetchSpy = vi.fn().mockResolvedValue({});
    vi.stubGlobal("fetch", fetchSpy);
    const task = (await app.completed())[0].record.task;
    dispatchWebhook("https://hooks.example/x", task, ["completed", "edited"], new Date(NOW));
    dispatchWebhook("ftp://nope", task, ["completed"], new Date(NOW));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual(webhookPayload(task, ["completed"], new Date(NOW)));
    vi.unstubAllGlobals();
  });
});

describe("push reminders", () => {
  it("plans 24h / 1h / due reminders inside a week, titles only when allowed", async () => {
    const app = await makeApp();
    unwrap(await app.createManualTask({ title: "Secret", importance: "untouched", deadline: { kind: "instant", at: "2026-09-11T12:00:00.000Z", timeZone: "UTC" } }));
    unwrap(await app.createManualTask({ title: "Far", importance: "untouched", deadline: { kind: "date", date: "2026-12-01", timeZone: "UTC" } }));
    const tasks = (await app.allViews()).map((v) => v.record.task);
    const plan = plannedReminders(tasks, new Date(NOW), false);
    expect(plan.map((p) => p.at)).toEqual(["2026-09-10T12:00:00.000Z", "2026-09-11T11:00:00.000Z", "2026-09-11T12:00:00.000Z"].filter((a) => a > NOW));
    expect(plan.every((p) => !p.body.includes("Secret"))).toBe(true);
    expect(plannedReminders(tasks, new Date(NOW), true)[0].body).toContain("Secret");
  });
});
