/**
 * Public calendar feeds client. Fetches each subscribed .ics through
 * /api/ics (CORS), parses it, and caches events in localStorage for a day.
 * Events are overlays only — never tasks.
 */
import type { CalendarFeed } from "@/domain/feeds";
import { type IcsEvent, parseIcs } from "@/domain/ics";

const TTL = 24 * 3_600_000;
const key = (url: string) => `focusgrid.feed.${url}`;

export async function loadFeedEvents(feed: CalendarFeed, force = false): Promise<{ events: IcsEvent[]; error: string | null }> {
  try {
    const hit = localStorage.getItem(key(feed.url));
    if (hit && !force) {
      const { at, events } = JSON.parse(hit) as { at: number; events: IcsEvent[] };
      if (Date.now() - at < TTL) return { events, error: null };
    }
  } catch {
    /* no cache */
  }
  try {
    const res = await fetch(`/api/ics?url=${encodeURIComponent(feed.url)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { events: [], error: body?.error?.message ?? `Feed responded ${res.status}.` };
    }
    const events = parseIcs(await res.text());
    try {
      localStorage.setItem(key(feed.url), JSON.stringify({ at: Date.now(), events }));
    } catch {
      /* quota — live fetch still works */
    }
    return { events, error: null };
  } catch {
    return { events: [], error: "Could not reach the feed." };
  }
}

export const forgetFeedCache = (url: string) => {
  try {
    localStorage.removeItem(key(url));
  } catch {
    /* ignore */
  }
};
