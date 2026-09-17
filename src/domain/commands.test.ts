import { describe, expect, it } from "vitest";
import { unwrap } from "@/test/unwrap";
import {
  archive,
  block,
  complete,
  createTask,
  type CreateInput,
  markStillRelevant,
  patchTask,
  reopen,
  resetAxisOverride,
  restore,
  setAxisOverride,
  setDragOverride,
  setManualProgress,
  setProgressSource,
  unblock,
} from "./commands";
import { externalTaskFieldsSchema, type TaskRecord } from "./task";
import { record as makeRecord } from "@/test/factory";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const CTX = new Set<string>(["11111111-1111-4111-8111-111111111111"]);

function make(overrides: Partial<CreateInput> = {}): TaskRecord {
  return unwrap(createTask({ id: "t1", title: "Task", ...overrides }, NOW, CTX)).record;
}

describe("createTask (38, 39.1)", () => {
  it("creates an active task at progress 0, revision 1, engine 1.0", () => {
    const t = make().task;
    expect(t).toMatchObject({ status: "active", progress: 0, revision: 1, engineVersion: "1.0" });
    expect(t.importance).toBe(0);
    expect(t.urgency).toBe(-0.6);
  });

  it("rejects whitespace-only title with zero mutation", () => {
    const r = createTask({ id: "x", title: "   " }, NOW, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("title");
  });

  it("rejects fractional / zero / oversized estimate; allows null", () => {
    for (const bad of [0, 2.5, 525_601]) {
      expect(createTask({ id: "x", title: "T", estimatedMinutes: bad }, NOW, CTX).ok).toBe(false);
    }
    expect(make({ estimatedMinutes: null }).task.estimatedMinutes).toBeNull();
  });

  it("rejects unknown context", () => {
    expect(createTask({ id: "x", title: "T", contextId: "nope" }, NOW, CTX).ok).toBe(false);
  });

  it("RED-17: undated task is allowed", () => {
    expect(make({ title: "Clean the garage" }).task.deadline).toBeNull();
  });

  it("provenance is 'default' for unset fields and 'user' for supplied ones", () => {
    const rec = make({ estimatedMinutes: 60 });
    expect(rec.provenance.title.source).toBe("user");
    expect(rec.provenance.estimatedMinutes.source).toBe("user");
    expect(rec.provenance.baseUrgency.source).toBe("default");
  });

  it("RED-37 style: out-of-range base values rejected, not clamped", () => {
    expect(createTask({ id: "x", title: "T", baseImportance: 82 }, NOW, CTX).ok).toBe(false);
    expect(createTask({ id: "x", title: "T", baseUrgency: Number.NaN }, NOW, CTX).ok).toBe(false);
  });

  it("43.6: AI baseUrgency on a dated task is rejected", () => {
    const r = createTask(
      {
        id: "x",
        title: "T",
        source: "ai",
        baseUrgency: 0.9,
        deadline: { kind: "date", date: "2026-09-12", timeZone: "America/Chicago" },
      },
      NOW,
      CTX,
    );
    expect(r.ok).toBe(false);
  });
});

describe("lifecycle (39.1)", () => {
  it("block → complete clears blocked reason; reopen stays active", () => {
    let r = block(make(), NOW, "waiting on review").ok
      ? unwrap(block(make(), NOW, "waiting on review")).record
      : make();
    expect(r.task.status).toBe("blocked");
    r = unwrap(complete(r, NOW)).record;
    expect(r.task).toMatchObject({ status: "completed", progress: 1, blockedReason: null });
    expect(r.task.completedAt).not.toBeNull();
    r = unwrap(reopen(r, NOW)).record;
    expect(r.task).toMatchObject({ status: "active", completedAt: null });
  });

  it("RED-53: reopen restores 60% in manual mode", () => {
    let r = make();
    r = unwrap(setManualProgress(r, 60, NOW)).record;
    r = unwrap(complete(r, NOW)).record;
    expect(r.task.progress).toBe(1);
    r = unwrap(reopen(r, NOW)).record;
    expect(r.task.progress).toBeCloseTo(0.6);
    expect(r.task.progressSource).toBe("manual");
  });

  it("RED-52: manual 100% completes with completedAt set", () => {
    const rec = unwrap(setManualProgress(make(), 100, NOW)).record;
    expect(rec.task).toMatchObject({ status: "completed", progress: 1 });
    expect(rec.task.completedAt).not.toBeNull();
  });

  it("RED-59: archive then restore a blocked task returns blocked with data intact", () => {
    let r = unwrap(block(make(), NOW, "reason")).record;
    r = unwrap(setAxisOverride(r, "importance", 0.4, "editor", NOW)).record;
    r = unwrap(archive(r, NOW)).record;
    expect(r.task.archivedFrom).toBe("blocked");
    r = unwrap(restore(r, NOW)).record;
    expect(r.task.status).toBe("blocked");
    expect(r.task.userImportanceOverride?.value).toBe(0.4);
  });

  it("archive on archived and complete on completed are idempotent no-ops", () => {
    const a = unwrap(archive(make(), NOW)).record;
    expect(unwrap(archive(a, NOW)).events).toEqual([]);
    const c = unwrap(complete(make(), NOW)).record;
    expect(unwrap(complete(c, NOW)).events).toEqual([]);
  });

  it("invalid transitions return CONFLICT and touch nothing", () => {
    expect(unblock(make(), NOW).ok).toBe(false);
    expect(reopen(make(), NOW).ok).toBe(false);
    const completed = unwrap(complete(make(), NOW)).record;
    expect(block(completed, NOW).ok).toBe(false);
  });

  it("completed task: notes editable, deadline not", () => {
    const c = unwrap(complete(make(), NOW)).record;
    expect(patchTask(c, { notes: "done" }, NOW, CTX).ok).toBe(true);
    expect(
      patchTask(c, { deadline: { kind: "date", date: "2026-10-01", timeZone: "UTC" } }, NOW, CTX).ok,
    ).toBe(false);
  });

  it("archived task rejects edits until restored", () => {
    const a = unwrap(archive(make(), NOW)).record;
    expect(patchTask(a, { title: "new" }, NOW, CTX).ok).toBe(false);
    expect(setManualProgress(a, 20, NOW).ok).toBe(false);
  });
});

describe("progress (39.2)", () => {
  it("RED-65: binary switch with partial progress needs explicit confirmation", () => {
    let r = unwrap(setManualProgress(make(), 40, NOW)).record;
    expect(setProgressSource(r, "binary", NOW).ok).toBe(false);
    r = unwrap(setProgressSource(r, "binary", NOW, true)).record;
    expect(r.task.progress).toBe(0);
  });

  it("RED-22: lowering progress on a completed task requires reopen", () => {
    const c = unwrap(complete(make(), NOW)).record;
    expect(setManualProgress(c, 50, NOW).ok).toBe(false);
  });
});

describe("overrides (39.3)", () => {
  it("RED-36: zero is a real override preserved as a value", () => {
    const r = unwrap(setAxisOverride(make(), "importance", 0, "editor", NOW)).record;
    expect(r.task.userImportanceOverride).toEqual(
      expect.objectContaining({ value: 0, source: "editor" }),
    );
    expect(r.task.importance).toBe(0);
  });

  it("RED-38: editing importance leaves urgency dynamic", () => {
    const r = unwrap(setAxisOverride(make(), "importance", 0.5, "editor", NOW)).record;
    expect(r.task.userImportanceOverride).not.toBeNull();
    expect(r.task.userUrgencyOverride).toBeNull();
  });

  it("setDragOverride writes BOTH axes with source 'drag' in one revision", () => {
    const r = unwrap(
      setDragOverride(make(), { urgency: 0.3, importance: -0.2 }, NOW),
    ).record;
    expect(r.task.userUrgencyOverride).toEqual(expect.objectContaining({ value: 0.3, source: "drag" }));
    expect(r.task.userImportanceOverride).toEqual(expect.objectContaining({ value: -0.2, source: "drag" }));
    expect(r.task.urgency).toBe(0.3);
    expect(r.task.importance).toBe(-0.2);
    expect(r.task.revision).toBe(2);
  });

  it("setDragOverride rejects out-of-range coordinates", () => {
    expect(setDragOverride(make(), { urgency: 1.5, importance: 0 }, NOW).ok).toBe(false);
  });

  it("reset clears only the chosen axis and restores base", () => {
    let r = unwrap(setAxisOverride(make(), "importance", 0.5, "editor", NOW)).record;
    r = unwrap(setAxisOverride(r, "urgency", 0.9, "drag", NOW)).record;
    r = unwrap(resetAxisOverride(r, "urgency", NOW)).record;
    expect(r.task.userUrgencyOverride).toBeNull();
    expect(r.task.userImportanceOverride?.value).toBe(0.5);
    expect(r.task.urgency).toBe(r.task.baseUrgency);
  });
});

describe("stale review (41.7)", () => {
  const overdue = () =>
    makeRecord({
      createdAt: "2026-08-01T00:00:00.000Z",
      deadline: { kind: "instant", at: "2026-08-20T00:00:00.000Z", timeZone: "UTC" },
    });

  it("markStillRelevant sets reviewAfter to now + 7 days, no priority change", () => {
    const r = unwrap(markStillRelevant(overdue(), NOW)).record;
    expect(r.task.reviewAfter).toBe(new Date(NOW.getTime() + 7 * 864e5).toISOString());
    expect(r.task.baseUrgency).toBe(-0.6);
    expect(r.task.deadline).not.toBeNull();
  });

  it("changing or clearing the deadline clears reviewAfter", () => {
    let r = unwrap(markStillRelevant(overdue(), NOW)).record;
    r = unwrap(
      patchTask(r, { deadline: { kind: "date", date: "2026-12-01", timeZone: "UTC" } }, NOW, CTX),
    ).record;
    expect(r.task.reviewAfter).toBeNull();
    r = unwrap(patchTask(r, { deadline: null }, NOW, CTX)).record;
    expect(r.task.reviewAfter).toBeNull();
  });
});

describe("patch null semantics (38.1)", () => {
  it("omitted key = unchanged; explicit null = clear", () => {
    let r = make({
      estimatedMinutes: 90,
      deadline: { kind: "instant", at: "2026-09-20T00:00:00.000Z", timeZone: "UTC" },
    });
    r = unwrap(patchTask(r, { title: "T2" }, NOW, CTX)).record;
    expect(r.task.estimatedMinutes).toBe(90);
    r = unwrap(patchTask(r, { estimatedMinutes: null }, NOW, CTX)).record;
    expect(r.task.estimatedMinutes).toBeNull();
    r = unwrap(patchTask(r, { deadline: null }, NOW, CTX)).record;
    expect(r.task.deadline).toBeNull();
    expect(r.task.deadlineRevision).toBe(2);
  });

  it("does not erase provenance for untouched fields", () => {
    let r = make({ estimatedMinutes: 90 });
    const before = r.provenance.estimatedMinutes;
    r = unwrap(patchTask(r, { notes: "x" }, NOW, CTX)).record;
    expect(r.provenance.estimatedMinutes).toEqual(before);
  });
});

describe("WAR-01-02: hostile object boundary", () => {
  it("strict schema rejects unknown keys, numeric strings, NaN, bad enums", () => {
    expect(externalTaskFieldsSchema.safeParse({ title: "T", evil: 1 }).success).toBe(false);
    expect(
      externalTaskFieldsSchema.safeParse({ title: "T", estimatedMinutes: "60" }).success,
    ).toBe(false);
    expect(
      externalTaskFieldsSchema.safeParse({ title: "T", baseUrgency: Infinity }).success,
    ).toBe(false);
    expect(
      externalTaskFieldsSchema.safeParse({ title: "T", progressSource: "auto" }).success,
    ).toBe(false);
    expect(externalTaskFieldsSchema.safeParse({ title: "  ok  " }).success).toBe(true);
  });
});

describe("V-01-03: purity", () => {
  it("commands do not read the clock or touch globals", () => {
    const src = createTask.toString() + patchTask.toString() + complete.toString();
    expect(src).not.toMatch(/Date\.now|new Date\(\)|localStorage|indexedDB|fetch\(/);
  });
});
