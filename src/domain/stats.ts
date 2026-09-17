/**
 * Focus statistics — pure. Completions per day, current streak, time spent.
 */
import type { Task } from "./task";

export interface DayStat {
  day: string; // yyyy-mm-dd in the given zone
  completed: number;
}

export interface FocusStats {
  days: DayStat[]; // oldest → newest, `span` entries
  streak: number; // consecutive days ending today with ≥1 completion
  completedTotal: number;
  minutesSpent: number;
}

const dayOf = (iso: string, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export function focusStats(tasks: Task[], now: Date, zone: string, span = 14): FocusStats {
  const counts = new Map<string, number>();
  let minutesSpent = 0;
  let completedTotal = 0;
  for (const t of tasks) {
    minutesSpent += t.timeSpentMinutes ?? 0;
    if (t.completedAt) {
      completedTotal++;
      const d = dayOf(t.completedAt, zone);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  const days: DayStat[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = dayOf(new Date(now.getTime() - i * 86_400_000).toISOString(), zone);
    days.push({ day: d, completed: counts.get(d) ?? 0 });
  }
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = dayOf(new Date(now.getTime() - i * 86_400_000).toISOString(), zone);
    if (counts.get(d)) streak++;
    else if (i === 0) continue; // today may still be empty; streak counts from yesterday
    else break;
    if (i > 3660) break;
  }
  return { days, streak, completedTotal, minutesSpent };
}
