/**
 * iCalendar export — pure. One VEVENT per dated unfinished task.
 * Date-only deadlines become all-day events; timed ones are UTC instants.
 */
import type { Task } from "./task";

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** RFC 5545 folding: lines of at most 75 octets (not characters), never splitting a code point. */
const fold = (line: string) => {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
};
const nextDay = (date: string) => new Date(Date.parse(date + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);

const endOf = (t: Task, startIso: string) =>
  stamp(new Date(Date.parse(startIso) + Math.min(t.estimatedMinutes ?? 30, 8 * 60) * 60_000).toISOString());

export function tasksToIcs(tasks: Task[], now: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FocusGrid//EN", "CALSCALE:GREGORIAN"];
  for (const t of tasks) {
    if (!t.deadline || t.status === "completed" || t.status === "archived") continue;
    lines.push("BEGIN:VEVENT", `UID:${t.id}@focusgrid`, `DTSTAMP:${stamp(now.toISOString())}`);
    if (t.deadline.kind === "date") {
      lines.push(`DTSTART;VALUE=DATE:${t.deadline.date.replace(/-/g, "")}`);
    } else {
      lines.push(`DTSTART:${stamp(t.deadline.at)}`, `DTEND:${endOf(t, t.deadline.at)}`);
    }
    lines.push(`SUMMARY:${esc(t.title)}`);
    if (t.notes) lines.push(`DESCRIPTION:${esc(t.notes)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Google Calendar "add event" link — no OAuth, opens a prefilled form. */
export function googleCalendarUrl(t: Task): string | null {
  if (!t.deadline) return null;
  const dates =
    t.deadline.kind === "date"
      ? `${t.deadline.date.replace(/-/g, "")}/${nextDay(t.deadline.date).replace(/-/g, "")}` // all-day: end is exclusive
      : `${stamp(t.deadline.at)}/${endOf(t, t.deadline.at)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: t.title, dates, details: t.notes });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// ── Import: public calendar feeds ─────────────────────────────────────
export interface IcsEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD for all-day events, ISO instant otherwise. */
  start: string;
  /** exclusive end, same shape as start; equals start's day+1 / start+1h when the feed omits DTEND */
  end: string;
  allDay: boolean;
  location: string;
}

const unesc = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([\\;,])/g, "$1");

/** Wall-clock (date, h:m) in `zone` → instant, via the zone's offset at that moment (DST-safe to the minute). */
export function zonedToInstant(date: string, h: number, m: number, zone: string): Date {
  const guess = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - ms;
  };
  try {
    const first = guess - offsetAt(guess);
    return new Date(guess - offsetAt(first)); // second pass lands the right side of a DST change
  } catch {
    return new Date(guess);
  }
}

const DT = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;
const parseDt = (value: string, params: string): { v: string; allDay: boolean } | null => {
  const m = DT.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h == null || /VALUE=DATE(?![-T])/i.test(params)) return { v: `${y}-${mo}-${d}`, allDay: true };
  const tz = /TZID=([^;:]+)/i.exec(params)?.[1] ?? null;
  const date = `${y}-${mo}-${d}`;
  const at = z || !tz ? new Date(`${date}T${h}:${mi}:00Z`) : zonedToInstant(date, +h, +mi, tz); // floating (no Z, no TZID) is read as UTC
  return Number.isNaN(at.getTime()) ? null : { v: at.toISOString(), allDay: false };
};

const plusDay = (d: string) => nextDay(d);
const plusHour = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString();

/**
 * Parse VEVENTs from an iCalendar text. Handles folding, DATE vs DATE-TIME,
 * TZID and UTC. Cancelled events are dropped.
 * ponytail: no RRULE expansion — public feeds (holidays, fixtures) ship expanded instances; add rrule if a feed needs it.
 */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: IcsEvent[] = [];
  let cur: Record<string, { params: string; value: string }> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT" && cur) {
      const start = cur.DTSTART && parseDt(cur.DTSTART.value, cur.DTSTART.params);
      if (start && cur.STATUS?.value.toUpperCase() !== "CANCELLED") {
        const end = cur.DTEND && parseDt(cur.DTEND.value, cur.DTEND.params);
        out.push({
          uid: cur.UID?.value ?? `${start.v}:${cur.SUMMARY?.value ?? ""}`,
          title: unesc(cur.SUMMARY?.value ?? "(untitled)"),
          start: start.v,
          end: end && end.allDay === start.allDay && end.v > start.v ? end.v : start.allDay ? plusDay(start.v) : plusHour(start.v),
          allDay: start.allDay,
          location: unesc(cur.LOCATION?.value ?? ""),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    cur[name.toUpperCase()] = { params: params.join(";"), value: line.slice(i + 1) };
  }
  return out;
}
