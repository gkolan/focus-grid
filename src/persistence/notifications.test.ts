import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unwrap } from "@/test/unwrap";
import { complete } from "@/domain/commands";
import { eventKey, type NotificationEvent } from "@/domain/notifications";
import { openFocusGridDB } from "./db";
import { TaskRepository, type CommandContext } from "./repository";

const NOW = new Date("2026-09-10T12:00:00.000Z"); // 12:00 UTC — outside default quiet hours
let seq = 0;
const ctx = (o: Partial<CommandContext> = {}): CommandContext => ({ operationId: `op-${++seq}`, now: NOW, ...o });
const CTX = { quietHours: { start: "21:00", end: "08:00" }, timeZone: "UTC", showTitles: false };

async function repo() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return new TaskRepository(o.db);
}
const inst = (from: Date, m: number) => ({
  kind: "instant" as const,
  at: new Date(from.getTime() + m * 60_000).toISOString(),
  timeZone: "UTC",
});
const evFor = (taskId: string): NotificationEvent => ({
  key: eventKey(taskId, 1, "deadline_approaching"),
  taskId,
  deadlineRevision: 1,
  type: "deadline_approaching",
  focusScore: 0.5,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("claimNotification (section 47)", () => {
  it("RED-89/126: a durable claim is never re-attempted (sequential or after 'restart')", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "t1", title: "T", deadline: inst(NOW, 1000) }, ctx()));
    const deliver = vi.fn(async () => true);

    expect(await r.claimNotification(evFor("t1"), NOW, CTX, deliver)).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
    // same key again — even from a "fresh" repo instance on the same DB
    const r2 = await repo();
    expect(await r2.claimNotification(evFor("t1"), NOW, CTX, deliver)).toBe("already_claimed");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("RED-91/WAR-12-02: task completed after claim window → revalidation suppresses delivery", async () => {
    const r = await repo();
    const c = unwrap(await r.create({ id: "t1", title: "T", deadline: inst(NOW, 1000) }, ctx()));
    unwrap(await r.mutate("t1", ctx({ expectedRevision: c.revision }), (rec, _k, now) => complete(rec, now)));
    const deliver = vi.fn(async () => true);
    expect(await r.claimNotification(evFor("t1"), NOW, CTX, deliver)).toBe("suppressed");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("RED-92: quiet hours suppress (no replay when quiet hours end)", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "t1", title: "T", deadline: inst(NOW, 1000) }, ctx()));
    const quietNow = new Date("2026-09-10T23:30:00.000Z"); // inside 21:00–08:00 UTC
    const deliver = vi.fn(async () => true);
    expect(await r.claimNotification(evFor("t1"), quietNow, CTX, deliver)).toBe("suppressed");
    // later, outside quiet hours — the same key is still claimed, no burst
    expect(await r.claimNotification(evFor("t1"), new Date("2026-09-11T09:00:00Z"), CTX, deliver)).toBe(
      "already_claimed",
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it("RED-25: app-wide cap of 3 delivered per rolling hour", async () => {
    const r = await repo();
    for (let i = 0; i < 5; i++) {
      unwrap(await r.create({ id: `t${i}`, title: `T${i}`, deadline: inst(NOW, 1000 + i) }, ctx()));
    }
    const deliver = vi.fn(async () => true);
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await r.claimNotification(evFor(`t${i}`), new Date(NOW.getTime() + i * 1000), CTX, deliver));
    }
    expect(results.filter((x) => x === "delivered")).toHaveLength(3);
    expect(results.filter((x) => x === "suppressed")).toHaveLength(2);
  });

  it("24h per-task cooldown", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "t1", title: "T", deadline: inst(NOW, 5000) }, ctx()));
    const deliver = vi.fn(async () => true);
    expect(
      await r.claimNotification(
        { ...evFor("t1"), key: eventKey("t1", 1, "deadline_approaching") },
        NOW,
        CTX,
        deliver,
      ),
    ).toBe("delivered");
    // a different event type for the same task, 6h later → cooldown
    expect(
      await r.claimNotification(
        { ...evFor("t1"), type: "do_now", key: eventKey("t1", 1, "do_now") },
        new Date(NOW.getTime() + 6 * 3600_000),
        CTX,
        deliver,
      ),
    ).toBe("suppressed");
  });

  it("a failed OS delivery is recorded as failed and not retried", async () => {
    const r = await repo();
    unwrap(await r.create({ id: "t1", title: "T", deadline: inst(NOW, 1000) }, ctx()));
    const deliver = vi.fn(async () => false);
    expect(await r.claimNotification(evFor("t1"), NOW, CTX, deliver)).toBe("failed");
    expect(await r.claimNotification(evFor("t1"), NOW, CTX, deliver)).toBe("already_claimed");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("WAR-12-01: a long-resume summary is one delivery, still obeying quiet hours", async () => {
    const r = await repo();
    const deliver = vi.fn(async () => true);
    expect(await r.claimSummary("2026-09-10T12", NOW, CTX, deliver)).toBe("delivered");
    expect(await r.claimSummary("2026-09-10T12", NOW, CTX, deliver)).toBe("already_claimed");
    // during quiet hours → suppressed
    expect(await r.claimSummary("2026-09-11T00", new Date("2026-09-11T00:30:00Z"), CTX, deliver)).toBe(
      "suppressed",
    );
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
