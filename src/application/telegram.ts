/** Drain task drafts captured by the Telegram bot into the local app. */
import type { Draft } from "@/telegram/server";
import { execute } from "./agent";
import type { FocusGridApp } from "./service";

/** Returns titles created, or null when the server has no Telegram integration (stop polling). */
export async function drainTelegram(app: FocusGridApp, ack: string[] = []): Promise<string[] | null> {
  const r = await fetch("/api/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, contexts: (await app.contexts()).map((c) => c.name), ack }),
  }).catch(() => null);
  // an unread body keeps the request "in flight" (breaks networkidle / keeps the connection busy) — drain it
  if (!r || r.status === 503 || !r.ok) {
    void r?.body?.cancel();
    return !r || r.status === 503 ? null : [];
  }
  const { drafts } = (await r.json()) as { drafts: Draft[] };
  const made: string[] = [];
  const done: string[] = [];
  for (const d of drafts) {
    const res = await execute(app, "create_task", d.input);
    if (res.ok) made.push(d.input.title);
    done.push(d.id); // a draft the app rejects is dropped too, or it would retry forever
  }
  if (done.length) await drainTelegram(app, done);
  return made;
}
