/**
 * Browser-side repository singleton + tab bus wiring. Application services and
 * React both go through this. Never imported by pure domain.
 */
import type { IDBPDatabase } from "idb";
import { DEMO_DB_NAME, openFocusGridDB } from "@/persistence/db";
import { TaskRepository } from "@/persistence/repository";
import { type TabBus, createTabBus } from "@/persistence/broadcast";
import type { FocusGridDB } from "@/persistence/schema";
import { systemClock, type Clock } from "@/domain/clock";
import { FocusGridApp } from "./service";
import { NotificationService, browserOsNotifier } from "./notifications";
import { seedDemo } from "./demo";
import { dispatchWebhook } from "./webhooks";
import { PRIORITY_CONFIG, withTuning } from "@/domain/config";

export type AppState =
  | {
      ok: true;
      app: FocusGridApp;
      repo: TaskRepository;
      db: IDBPDatabase<FocusGridDB>;
      bus: TabBus;
      notifications: NotificationService;
      demo: boolean;
    }
  | { ok: false; code: string; message: string };

let promise: Promise<AppState> | null = null;
const listeners = new Set<() => void>();

/** Swappable in tests via the ?e2e seam; production uses the system clock. */
export const appClock: { current: Clock } = { current: systemClock };
/** A stable clock reference that always reads the current `appClock.current`. */
const liveClock: Clock = { now: () => appClock.current.now() };
/** Demo seeding only: pin the app clock to `at` (null restores the system clock). */
const travel = (at: Date | null): void => { appClock.current = at ? { now: () => new Date(at) } : systemClock; };

function isDemo(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
}

async function build(): Promise<AppState> {
  const demo = isDemo();
  const outcome = await openFocusGridDB(demo ? DEMO_DB_NAME : undefined);
  if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message };
  const bus = createTabBus(demo ? "focusgrid-demo-invalidate" : undefined);
  const repo = new TaskRepository(outcome.db, undefined, {
    onCommitted: (taskId, revision) => bus.post({ taskId, revision, source: instanceId }),
    onEvents: (task, events) => {
      void repo.getSettings().then((s) => {
        if (s?.webhookUrl) dispatchWebhook(s.webhookUrl, task, events, liveClock.now());
      });
    },
  });
  // user tuning of the priority curve, if any was saved.
  const saved = await repo.getSettings();
  if (saved?.priorityTuning) repo.setPriorityConfig(withTuning(PRIORITY_CONFIG, saved.priorityTuning));
  bus.subscribe((msg) => {
    if (msg.source !== instanceId) notify();
  });
  const app = new FocusGridApp(repo, liveClock, outcome.db);
  const notifications = new NotificationService(repo, liveClock, () => repo.getSettings(), browserOsNotifier);

  if (demo) {
    // Fresh demo on every server restart: the layout stamps a per-process boot id.
    const boot = document.body.dataset.boot ?? "";
    const stale = localStorage.getItem("focusgrid-demo-boot") !== boot;
    if (stale) {
      await repo.deleteAllLocalData();
      localStorage.setItem("focusgrid-demo-boot", boot);
    }
    if (stale || (await repo.listTasks()).length === 0) await seedDemo(app, liveClock.now(), travel);
  }
  return { ok: true, app, repo, db: outcome.db, bus, notifications, demo };
}

const instanceId = typeof crypto !== "undefined" ? crypto.randomUUID() : "server";

export function getAppState(): Promise<AppState> {
  if (typeof window === "undefined") {
    return Promise.resolve({ ok: false, code: "SSR", message: "not available during server render" });
  }
  promise ??= build();
  return promise;
}

/** Wipe the demo database (demo mode only) so the next "Try demo" starts fresh. */
export async function clearDemo(): Promise<void> {
  const s = await getAppState();
  if (!s.ok || !s.demo) return;
  await s.repo.deleteAllLocalData();
}

/** Reset the demo database (demo mode only) and reseed the persona fixture. */
export async function resetDemo(): Promise<void> {
  const s = await getAppState();
  if (!s.ok || !s.demo) return;
  await s.repo.deleteAllLocalData();
  await seedDemo(s.app, liveClock.now(), travel);
  notify();
}

export function onExternalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const l of listeners) l();
}
