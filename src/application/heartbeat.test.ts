import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "@/test/fake-clock";
import { HeartbeatController } from "./heartbeat";

// Minimal DOM stubs — vitest runs in node.
const listeners: Record<string, Set<() => void>> = {};
function fakeTarget() {
  return {
    addEventListener: (t: string, fn: () => void) => (listeners[t] ??= new Set()).add(fn),
    removeEventListener: (t: string, fn: () => void) => listeners[t]?.delete(fn),
  };
}

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).document = {
    visibilityState: "visible",
    ...fakeTarget(),
  };
  (globalThis as Record<string, unknown>).window = { ...fakeTarget() };
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

function makeRepo() {
  const recalcPass = vi.fn(async () => {
    await Promise.resolve();
    return { recalculated: 0, animatedIds: [] as string[], events: [] as [] };
  });
  return { recalcPass } as unknown as import("@/persistence/repository").TaskRepository & {
    recalcPass: ReturnType<typeof vi.fn>;
  };
}

describe("HeartbeatController (42.1 / RED-112)", () => {
  it("runs one immediate pass on start and one per 15 minutes", async () => {
    const repo = makeRepo();
    const hb = new HeartbeatController({ repo, clock: new FakeClock("2026-09-10T12:00:00Z"), onPass: () => {} });
    hb.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.recalcPass).toHaveBeenCalledTimes(1); // catch-up pass
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(repo.recalcPass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(repo.recalcPass).toHaveBeenCalledTimes(3);
    hb.stop();
  });

  it("ten start()/remount cycles create one effective schedule, not ten", async () => {
    const repo = makeRepo();
    const clock = new FakeClock("2026-09-10T12:00:00Z");
    for (let i = 0; i < 10; i++) {
      const hb = new HeartbeatController({ repo, clock, onPass: () => {} });
      hb.start();
      await vi.advanceTimersByTimeAsync(0);
      hb.stop();
    }
    const callsAfterMounts = repo.recalcPass.mock.calls.length; // 10 catch-up passes, timers cleared
    // advance a full period — no leaked interval should fire
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(repo.recalcPass).toHaveBeenCalledTimes(callsAfterMounts);
  });

  it("suspends while hidden and does one pass on becoming visible again", async () => {
    const repo = makeRepo();
    const doc = (globalThis as Record<string, unknown>).document as { visibilityState: string };
    const hb = new HeartbeatController({ repo, clock: new FakeClock("2026-09-10T12:00:00Z"), onPass: () => {} });
    hb.start();
    await vi.advanceTimersByTimeAsync(0);
    const base = repo.recalcPass.mock.calls.length;

    doc.visibilityState = "hidden";
    listeners.visibilitychange?.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(60 * 60_000); // an hour hidden — no passes
    expect(repo.recalcPass).toHaveBeenCalledTimes(base);

    doc.visibilityState = "visible";
    listeners.visibilitychange?.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.recalcPass).toHaveBeenCalledTimes(base + 1); // exactly one catch-up, not 4
    hb.stop();
  });
});
