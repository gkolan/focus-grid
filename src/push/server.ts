/**
 * Web Push — server-only. The browser computes deadline reminders with the
 * client-side engine and hands them here; this module stores them next to the
 * push subscription and sends each one when its time comes, so alerts arrive
 * even with the tab closed. Tasks never reach the server — only reminder
 * bodies and times.
 *
 * ponytail: JSON file + in-process timer. Fine for `next start` on one box;
 * move to a DB + cron worker for multi-instance deployments.
 */
if (typeof window !== "undefined") throw new Error("src/push/server.ts is server-only");
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import webpush, { type PushSubscription } from "web-push";
import { z } from "zod";

export const reminderSchema = z
  .object({
    at: z.string().datetime(),
    body: z.string().min(1).max(200),
    tag: z.string().min(1).max(120),
  })
  .strict();
export const subscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2000).startsWith("https://"), // push services are https; never let the server POST elsewhere
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }).strict(),
  })
  .strict();
export type Reminder = z.infer<typeof reminderSchema>;

interface Entry {
  subscription: PushSubscription;
  reminders: Reminder[];
}

const FILE = join(process.cwd(), ".data", "push.json");
/** Hard cap on stored subscriptions — the endpoint is unauthenticated, so the store must not grow without bound. */
export const MAX_SUBSCRIPTIONS = Number(process.env.FOCUSGRID_PUSH_MAX_SUBSCRIPTIONS) || 2000;
/** Serialises every load→modify→save so the timer and requests never lose each other's writes. */
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export function pushConfig(): { enabled: boolean; publicKey: string | null } {
  const pub = process.env.FOCUSGRID_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.FOCUSGRID_VAPID_PRIVATE_KEY?.trim();
  return { enabled: !!pub && !!priv, publicKey: pub || null };
}

function load(): Record<string, Entry> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Entry>;
  } catch {
    return {};
  }
}
function save(data: Record<string, Entry>): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(data));
}
const keyOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

export function upsertSubscription(subscription: PushSubscription, reminders: Reminder[]): Promise<boolean> {
  return locked(() => {
    const data = load();
    const key = keyOf(subscription.endpoint);
    if (!(key in data) && Object.keys(data).length >= MAX_SUBSCRIPTIONS) return false;
    data[key] = { subscription, reminders: reminders.slice(0, 200) };
    save(data);
    return true;
  });
}

export function removeSubscription(endpoint: string): Promise<void> {
  return locked(() => {
    const data = load();
    delete data[keyOf(endpoint)];
    save(data);
  });
}

function configure(): boolean {
  const { enabled } = pushConfig();
  if (!enabled) return false;
  webpush.setVapidDetails(
    process.env.FOCUSGRID_VAPID_SUBJECT?.trim() || "mailto:focusgrid@example.com",
    process.env.FOCUSGRID_VAPID_PUBLIC_KEY!.trim(),
    process.env.FOCUSGRID_VAPID_PRIVATE_KEY!.trim(),
  );
  return true;
}

/** Send every reminder whose time has come; drop dead subscriptions (404/410). */
export async function sendDue(now = new Date()): Promise<{ sent: number; dropped: number }> {
  if (!configure()) return { sent: 0, dropped: 0 };
  // take the due reminders out under the lock, send outside it, then drop dead subscriptions under the lock again
  const batch = await locked(() => {
    const data = load();
    const out: Array<{ key: string; subscription: PushSubscription; due: Reminder[] }> = [];
    for (const [key, entry] of Object.entries(data)) {
      const due = entry.reminders.filter((r) => Date.parse(r.at) <= now.getTime());
      if (!due.length) continue;
      entry.reminders = entry.reminders.filter((r) => Date.parse(r.at) > now.getTime());
      out.push({ key, subscription: entry.subscription, due });
    }
    if (out.length) save(data);
    return out;
  });
  let sent = 0;
  const dead: string[] = [];
  for (const { key, subscription, due } of batch) {
    for (const r of due) {
      try {
        await webpush.sendNotification(subscription, JSON.stringify({ title: "FocusGrid", body: r.body, tag: r.tag }), { TTL: 6 * 3600 });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(key);
          break;
        }
      }
    }
  }
  if (dead.length) {
    await locked(() => {
      const data = load();
      for (const k of dead) delete data[k];
      save(data);
    });
  }
  return { sent, dropped: dead.length };
}

/** One timer per process, started lazily by the first API hit. */
export function ensureScheduler(): void {
  const g = globalThis as { __focusgridPush?: ReturnType<typeof setInterval> };
  if (g.__focusgridPush || !pushConfig().enabled) return;
  g.__focusgridPush = setInterval(() => void sendDue().catch(() => {}), 60_000);
  g.__focusgridPush.unref?.();
}
