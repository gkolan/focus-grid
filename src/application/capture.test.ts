import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { FakeClock } from "@/test/fake-clock";
import { FocusGridApp } from "./service";

const NOW = "2026-09-09T14:00:00.000Z";
const TZ = "America/Chicago";
const nf = { value: null, confidence: null, rationale: null, ambiguity: null, sourceText: null };
const proposal = (over: Record<string, unknown>) => ({
  schemaVersion: "1",
  fields: { title: nf, notes: nf, deadline: nf, startAt: nf, estimatedMinutes: nf, contextId: nf, baseImportance: nf, baseUrgency: nf, ...over },
});

function mockFetch(status: number, jsonBody: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
  })) as unknown as typeof fetch;
}

async function makeApp() {
  const o = await openFocusGridDB();
  if (!o.ok) throw new Error(o.code);
  return new FocusGridApp(new TaskRepository(o.db, undefined, {}), new FakeClock(NOW), o.db);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureWithAI (section 43)", () => {
  it("canonical: applies high-confidence title/deadline/estimate; creates exactly one task", async () => {
    globalThis.fetch = mockFetch(
      200,
      proposal({
        title: { value: "Prepare interview", confidence: 0.95, rationale: "names it", ambiguity: null, sourceText: "Prepare interview" },
        deadline: { value: { kind: "date", date: "2026-09-11", timeZone: TZ }, confidence: 0.95, rationale: "Friday", ambiguity: null, sourceText: "Friday" },
        estimatedMinutes: { value: 180, confidence: 0.95, rationale: "3h", ambiguity: null, sourceText: "3 hours" },
      }),
    );
    const app = await makeApp();
    const res = await app.captureWithAI("Prepare interview Friday for 3 hours.", TZ);
    expect(res.ok).toBe(true);
    const views = await app.allViews();
    expect(views).toHaveLength(1);
    const t = views[0].record.task;
    expect(t.title).toBe("Prepare interview");
    expect(t.deadline).toEqual({ kind: "date", date: "2026-09-11", timeZone: TZ });
    expect(t.estimatedMinutes).toBe(180);
    // provenance is AI for the applied fields
    expect(views[0].record.provenance.title.source).toBe("ai");
    // interpretation metadata persisted
    expect(await app.interpretationsFor(t.id)).toHaveLength(1);
  });

  it("RED-124: undated urgency proposal is NOT auto-applied even at 0.99; task still created", async () => {
    globalThis.fetch = mockFetch(
      200,
      proposal({
        title: { value: "Handle the leaking pipe", confidence: 0.9, rationale: "restates", ambiguity: null, sourceText: "Handle the leaking pipe" },
        baseUrgency: { value: 0.8, confidence: 0.99, rationale: "explicit", ambiguity: null, sourceText: "right now" },
      }),
    );
    const app = await makeApp();
    const res = await app.captureWithAI("Handle the leaking pipe right now", TZ);
    expect(res.ok).toBe(true);
    const t = (await app.allViews())[0].record.task;
    expect(t.baseUrgency).toBe(-0.6); // default — not applied
    if (res.ok) {
      const urg = res.result.fields.find((f) => f.key === "baseUrgency")!;
      expect(urg.applied).toBe(false);
      expect(urg.needsAcceptance).toBe(true);
      expect(urg.applicable).toBe(true);
    }
  });

  it("RED-69: an ambiguous date is never auto-applied regardless of confidence", async () => {
    globalThis.fetch = mockFetch(
      200,
      proposal({
        title: { value: "Submit form", confidence: 0.9, rationale: "restates", ambiguity: null, sourceText: "Submit form" },
        deadline: { value: { kind: "date", date: "2026-04-05", timeZone: TZ }, confidence: 0.99, rationale: "date", ambiguity: "04/05 could be April 5 or May 4", sourceText: "04/05" },
      }),
    );
    const app = await makeApp();
    const res = await app.captureWithAI("Submit form 04/05", TZ);
    expect(res.ok).toBe(true);
    expect((await app.allViews())[0].record.task.deadline).toBeNull();
  });

  it("RED-70/72: a late/stale response is dropped after the user saved manually", async () => {
    let resolveFetch!: (v: unknown) => void;
    globalThis.fetch = vi.fn(
      () => new Promise((r) => (resolveFetch = r)),
    ) as unknown as typeof fetch;
    const app = await makeApp();
    const capturePromise = app.captureWithAI("Prepare interview Friday for 3 hours.", TZ);
    // user gives up and saves manually
    await app.saveManualCapture("Prepare interview Friday for 3 hours.");
    // now the AI response finally arrives
    resolveFetch({
      ok: true,
      status: 200,
      json: async () =>
        proposal({ title: { value: "Prepare interview", confidence: 0.95, rationale: "x", ambiguity: null, sourceText: "Prepare interview" } }),
    });
    const res = await capturePromise;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fallback).toBe("cancelled");
    // exactly one task, from the manual save
    expect(await app.allViews()).toHaveLength(1);
  });

  it("RED-73: a provider auth failure surfaces a generic message, no secret", async () => {
    globalThis.fetch = mockFetch(503, { error: { code: "AI_UNAVAILABLE", message: "AI capture is unavailable." } });
    const app = await makeApp();
    const res = await app.captureWithAI("something", TZ);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fallback).toBe("unavailable");
      expect(res.message).not.toMatch(/key|secret|token|openai/i);
    }
    expect(await app.allViews()).toHaveLength(0);
  });

  it("offline (fetch throws) → fallback, no task, draft kept at caller", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const app = await makeApp();
    const res = await app.captureWithAI("clean garage soon", TZ);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fallback).toBe("offline");
    expect(await app.allViews()).toHaveLength(0);
  });

  it("RED-83: clearing interpretation history removes metadata, keeps task values + ai provenance", async () => {
    globalThis.fetch = mockFetch(
      200,
      proposal({
        title: { value: "Prepare interview", confidence: 0.95, rationale: "names it", ambiguity: null, sourceText: "Prepare interview" },
        estimatedMinutes: { value: 180, confidence: 0.95, rationale: "3h", ambiguity: null, sourceText: "3 hours" },
      }),
    );
    const app = await makeApp();
    await app.captureWithAI("Prepare interview Friday for 3 hours.", TZ);
    const before = (await app.allViews())[0].record.task;

    const cleared = await app.clearInterpretationHistory();
    expect(cleared.removed).toBe(1);
    const after = (await app.allViews())[0].record;
    expect(after.task.title).toBe(before.title);
    expect(after.task.estimatedMinutes).toBe(180);
    expect(after.provenance.title.source).toBe("ai");
    expect(after.provenance.title.interpretationId).toBeNull();
    expect(await app.interpretationsFor(after.task.id)).toHaveLength(0);
  });

  it("multi-task input keeps the full text in notes and states one-at-a-time", async () => {
    globalThis.fetch = mockFetch(
      200,
      proposal({
        title: { value: "Buy milk", confidence: 0.9, rationale: "first task", ambiguity: null, sourceText: "Buy milk" },
      }),
    );
    const app = await makeApp();
    const res = await app.captureWithAI("Buy milk and call the dentist and book flights", TZ);
    expect(res.ok).toBe(true);
    const t = (await app.allViews())[0].record.task;
    expect(t.notes).toContain("call the dentist");
    if (res.ok) expect(res.result.multiTaskNotice).toBe(true);
  });
});
