import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { calculatePriority } from "@/domain/priority";
import { scoreTask } from "@/domain/score";
import { task } from "@/test/factory";
import { openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";

const NOW = new Date("2026-09-10T12:00:00.000Z");
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("§52 performance budgets (recorded, not tuned)", () => {
  it("1000-task pure priority: median over 20 runs [target ≤ 50ms]", () => {
    const tasks = Array.from({ length: 1000 }, (_, i) =>
      task({
        id: `t${i}`,
        createdAt: "2026-08-01T00:00:00Z",
        deadline: {
          kind: "instant",
          at: new Date(NOW.getTime() + (i - 500) * 3_600_000).toISOString(),
          timeZone: "UTC",
        },
        estimatedMinutes: i % 3 === 0 ? null : 60 + i,
        progress: i % 4 === 0 ? 0.3 : 0,
        progressSource: "manual",
      }),
    );
    const runs: number[] = [];
    for (let r = 0; r < 20; r++) {
      const t0 = performance.now();
      for (const t of tasks) {
        const p = calculatePriority(t, NOW);
        scoreTask(t, p);
      }
      runs.push(performance.now() - t0);
    }
    const m = median(runs);
    console.log(`PERF 1000-task pure priority median = ${m.toFixed(1)}ms (target ≤ 50ms)`);
    expect(m).toBeLessThan(50);
  });

  it("recalcPass over 250 active tasks on fake-indexeddb [reference only]", async () => {
    const o = await openFocusGridDB();
    if (!o.ok) throw new Error(o.code);
    const repo = new TaskRepository(o.db);
    let op = 0;
    for (let i = 0; i < 250; i++) {
      await repo.create(
        {
          id: `t${i}`,
          title: `Task ${i}`,
          deadline: {
            kind: "instant",
            at: new Date(NOW.getTime() + (i - 125) * 3_600_000).toISOString(),
            timeZone: "UTC",
          },
        },
        { operationId: `op-${++op}`, now: NOW },
      );
    }
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const at = new Date(NOW.getTime() + (r + 1) * 6 * 3_600_000);
      const t0 = performance.now();
      await repo.recalcPass(at);
      runs.push(performance.now() - t0);
    }
    console.log(
      `PERF recalcPass(250) median = ${median(runs).toFixed(0)}ms on fake-indexeddb ` +
        `(NOT representative of a real browser IDB — the ≤500ms/1000-task budget is measured in e2e/perf.spec.ts)`,
    );
    expect(median(runs)).toBeGreaterThan(0);
  }, 120_000);
});
