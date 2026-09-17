/** Public calendar subscriptions — read-only overlays on the calendar view. */
export interface CalendarFeed {
  id: string;
  name: string;
  url: string; // normalized https/http
  color: string;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|\[fc|\[fd|\[fe80)/i;

/** webcal:// → https://; rejects non-http(s) schemes and private/loopback hosts (the proxy fetches this server-side). */
export function normalizeFeedUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^webcal:/i, "https:"));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (PRIVATE_HOST.test(u.hostname) || !u.hostname.includes(".")) return null;
  return u.toString();
}

/** Google's public holiday calendars — stable URL pattern, one per region. */
export const HOLIDAY_PRESETS: Array<{ label: string; url: string }> = [
  ["United States", "en.usa"],
  ["United Kingdom", "en.uk"],
  ["India", "en.indian"],
  ["Canada", "en.canadian"],
  ["Australia", "en.australian"],
  ["Germany", "en.german"],
  ["France", "en.french"],
  ["Spain", "en.spain"],
  ["Ireland", "en.irish"],
  ["Netherlands", "en.dutch"],
].map(([label, id]) => ({ label: `${label} holidays`, url: `https://calendar.google.com/calendar/ical/${encodeURIComponent(`${id}#holiday@group.v.calendar.google.com`)}/public/basic.ics` }));
