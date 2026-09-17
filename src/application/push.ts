/**
 * Web Push client. The engine stays in the browser: this computes the next
 * week of deadline reminders from local tasks and posts them (with the push
 * subscription) to /api/push, which delivers them even when the tab is closed.
 * Titles are sent only when the user opted into titles in notifications.
 */
import type { Task } from "@/domain/task";
import { deadlineCutoffMs } from "@/domain/deadline";

export interface Reminder {
  at: string;
  body: string;
  tag: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Pure: reminders for unfinished dated tasks in the next 7 days (24h before, 1h before timed, at cutoff). */
export function plannedReminders(tasks: Task[], now: Date, showTitles: boolean): Reminder[] {
  const out: Reminder[] = [];
  const nowMs = now.getTime();
  const name = (t: Task) => (showTitles ? `“${t.title}”` : "A task");
  for (const t of tasks) {
    if (!t.deadline || (t.status !== "active" && t.status !== "blocked")) continue;
    const cutoff = deadlineCutoffMs(t.deadline);
    const steps: Array<[number, string]> = [
      [cutoff - DAY, `${name(t)} is due in a day.`],
      [cutoff, `${name(t)} is due now.`],
    ];
    if (t.deadline.kind === "instant") steps.splice(1, 0, [cutoff - HOUR, `${name(t)} is due in an hour.`]);
    for (const [at, body] of steps) {
      if (at > nowMs && at < nowMs + 7 * DAY) out.push({ at: new Date(at).toISOString(), body, tag: `${t.id}:${t.deadlineRevision}:${at}` });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 200);
}

export async function pushCapability(): Promise<{ enabled: boolean; publicKey: string | null }> {
  try {
    const r = await fetch("/api/push", { cache: "no-store" });
    if (r.ok) return await r.json();
    void r.body?.cancel();
    return { enabled: false, publicKey: null };
  } catch {
    return { enabled: false, publicKey: null };
  }
}

function toKey(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function subscribePush(publicKey: string): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  try {
    return (
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) as BufferSource }))
    );
  } catch {
    return null;
  }
}

export async function unsubscribePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Replace the server-side schedule with the current plan. Silent no-op when not subscribed. */
export async function syncReminders(tasks: Task[], now: Date, showTitles: boolean): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  const r = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), reminders: plannedReminders(tasks, now, showTitles) }),
  }).catch(() => null);
  void r?.body?.cancel(); // never read; release the connection
  return !!r?.ok;
}
