import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { execute } from "./agent";
import { FocusGridApp } from "./service";

async function makeApp() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return new FocusGridApp(new TaskRepository(o.db), new FakeClock("2026-09-10T12:00:00.000Z"), o.db);
}
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} } as unknown as Storage;
});

describe("assistant tools", () => {
  it("creates, lists, updates and completes a task", async () => {
    const app = await makeApp();
    const made = await execute(app, "create_task", { title: "Dentist", startAt: "2026-09-15T14:00:00Z", estimatedMinutes: 60, deadlineDate: "2026-09-15" });
    expect(made.ok).toBe(true);
    const { id } = JSON.parse(made.content);
    const listed = JSON.parse((await execute(app, "list_tasks", {})).content);
    expect(listed).toMatchObject([{ id, title: "Dentist", startAt: "2026-09-15T14:00:00Z", deadline: "2026-09-15" }]);
    expect((await execute(app, "update_task", { id, title: "Dentist (Dr Lee)" })).ok).toBe(true);
    expect((await execute(app, "complete_task", { id })).ok).toBe(true);
    expect((await app.allViews())[0].record.task).toMatchObject({ title: "Dentist (Dr Lee)", status: "completed" });
  });

  it("rejects malformed model input and unknown contexts", async () => {
    const app = await makeApp();
    expect((await execute(app, "create_task", { title: "x", deadlineAt: "tomorrow" })).ok).toBe(false);
    expect((await execute(app, "create_task", { title: "x", contextName: "Nope" })).ok).toBe(false);
    expect((await execute(app, "nuke_everything", {})).ok).toBe(false);
  });

  it("rolls back a feed that does not verify", async () => {
    const app = await makeApp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 502 })));
    const r = await execute(app, "add_calendar_feed", { name: "Chelsea", url: "https://example.com/dead.ics" });
    expect(r.ok).toBe(false);
    expect(await app.calendarFeeds()).toHaveLength(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", { status: 200 })));
    const ok = await execute(app, "add_calendar_feed", { name: "Chelsea", url: "webcal://example.com/live.ics" });
    expect(ok.ok).toBe(true);
    expect(await app.calendarFeeds()).toMatchObject([{ name: "Chelsea", url: "https://example.com/live.ics" }]);
    vi.unstubAllGlobals();
  });
});
