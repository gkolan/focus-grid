/**
 * Time-zone-aware deadline math — contract section 40. No manual IANA rules:
 * offsets come from `Intl.DateTimeFormat`. All functions are pure.
 */
import type { Deadline } from "./task";

/** Offset (ms) to add to a UTC instant to get wall-clock time in `tz`. */
function tzOffsetMs(tz: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUTC - instant.getTime();
}

/** Add `days` calendar days to a `YYYY-MM-DD` string (handles month/year rollover). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * UTC epoch ms for local wall time `y-mo-d h:mi:s` in `tz`.
 * `outcome` flags nonexistent (spring-forward gap) and ambiguous (fall-back)
 * local times so the editor can require correction / occurrence choice (40.3).
 */
export function zonedWallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): { utc: number; outcome: "ok" | "nonexistent" | "ambiguous"; second?: number } {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const H12 = 12 * 3_600_000;
  const offBefore = tzOffsetMs(tz, new Date(wall - H12));
  const offAfter = tzOffsetMs(tz, new Date(wall + H12));
  const roundtrips = (utc: number) => tzOffsetMs(tz, new Date(utc)) + utc === wall;

  const c1 = wall - offBefore;
  const c2 = wall - offAfter;
  const a = roundtrips(c1);
  const b = roundtrips(c2);

  if (offBefore === offAfter || c1 === c2) {
    return a ? { utc: c1, outcome: "ok" } : { utc: c1, outcome: "nonexistent" };
  }
  if (a && b) {
    const [first, second] = c1 < c2 ? [c1, c2] : [c2, c1];
    return { utc: first, outcome: "ambiguous", second };
  }
  if (a) return { utc: c1, outcome: "ok" };
  if (b) return { utc: c2, outcome: "ok" };
  return { utc: Math.min(c1, c2), outcome: "nonexistent" };
}

/**
 * The instant at which a deadline becomes overdue.
 * - instant: the stored instant.
 * - date-only: start of the *next* local calendar day in the stored zone
 *   (a Sep-11 task is due through Sep 11 and overdue at Sep 12 00:00 local).
 */
export function deadlineCutoffMs(deadline: Deadline): number {
  if (deadline.kind === "instant") return Date.parse(deadline.at);
  const next = addDays(deadline.date, 1);
  const [y, m, d] = next.split("-").map(Number);
  return zonedWallTimeToUtc(y, m, d, 0, 0, 0, deadline.timeZone).utc;
}

/** Whole minutes from `now` to the cutoff; negative when overdue. */
export function minutesToDeadline(deadline: Deadline, now: Date): number {
  return (deadlineCutoffMs(deadline) - now.getTime()) / 60_000;
}

export function isOverdue(deadline: Deadline, now: Date): boolean {
  return now.getTime() >= deadlineCutoffMs(deadline);
}

export type DueRange = "day" | "week" | "month";
export interface DueWindow { start: number; end: number; label: string }

/** `YYYY-MM-DD` of `now` in `tz`. */
export function ymdIn(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** First day of the day/week (Sun–Sat, Outlook convention)/month containing `ymd`. */
export function dueRangeStart(range: DueRange, ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (range === "day") return ymd;
  if (range === "week") return addDays(ymd, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Shift a period start by `n` periods. */
export function dueRangeShift(range: DueRange, start: string, n: number): string {
  if (range === "day") return addDays(start, n);
  if (range === "week") return addDays(start, 7 * n);
  const [y, m] = start.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

/** Window [start, end) ms for the period starting at `start` (from dueRangeStart), plus a display label. */
export function dueWindow(range: DueRange, start: string, tz: string): DueWindow {
  const next = dueRangeShift(range, start, 1);
  const last = addDays(next, -1);
  const toMs = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return zonedWallTimeToUtc(y, m, d, 0, 0, 0, tz).utc; };
  const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(ymd + "T00:00:00Z").toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  const label =
    range === "month" ? fmt(start, { month: "short", year: "numeric" })
    : range === "day" ? fmt(start, { month: "short", day: "numeric", year: "numeric" })
    : start.slice(0, 7) === last.slice(0, 7)
      ? `${fmt(start, { month: "short", day: "numeric" })} – ${last.slice(8).replace(/^0/, "")}, ${last.slice(0, 4)}`
      : `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(last, { month: "short", day: "numeric", year: "numeric" })}`;
  return { start: toMs(start), end: toMs(next), label };
}
