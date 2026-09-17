/**
 * Outbound webhooks. Fire-and-forget POST of task events to one user-set
 * URL (Zapier / Make / n8n catch hooks). `no-cors` so any endpoint works from
 * the browser; the response is opaque and never read. Best effort, no retry.
 */
import type { Task } from "@/domain/task";

export const WEBHOOK_EVENTS = ["created", "completed", "blocked", "unblocked", "reopened", "archived", "restored", "deadline_changed"] as const;

export function isWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
  } catch {
    return false;
  }
}

export function webhookPayload(task: Task, events: string[], at: Date) {
  const { id, title, notes, status, progress, deadline, estimatedMinutes, contextId, tags, assignee, importance, urgency } = task;
  return { source: "focusgrid", at: at.toISOString(), events, task: { id, title, notes, status, progress, deadline, estimatedMinutes, contextId, tags: tags ?? [], assignee: assignee ?? null, importance, urgency } };
}

export function dispatchWebhook(url: string, task: Task, events: string[], at: Date): void {
  const interesting = events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!interesting.length || !isWebhookUrl(url) || typeof fetch === "undefined") return;
  const body = JSON.stringify(webhookPayload(task, interesting, at));
  // A CORS request keeps the JSON content-type (no-cors strips it to text/plain); when the host
  // does not answer the preflight, fall back to no-cors so the payload still arrives as text.
  void fetch(url, { method: "POST", mode: "cors", headers: { "content-type": "application/json" }, body, keepalive: true })
    .catch(() => fetch(url, { method: "POST", mode: "no-cors", body, keepalive: true }))
    .catch(() => {});
}
