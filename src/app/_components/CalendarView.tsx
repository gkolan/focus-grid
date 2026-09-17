"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import type { TaskView } from "@/application/service";
import type { CalendarFeed } from "@/domain/feeds";
import type { IcsEvent } from "@/domain/ics";
import { loadFeedEvents } from "@/application/feeds";
import { addDays, type DueRange } from "@/domain/deadline";
import { labelText, remainingEffortText } from "./format";
import { Markdown } from "./Markdown";

/** Day / week / month grid of unfinished tasks by deadline day in the display zone. Period comes from the shell's time-range bar. */
export function CalendarView({ displayZone, onOpen, range, start, contextFilter }: { displayZone: string; onOpen: (v: TaskView) => void; range: DueRange; start: string; contextFilter: string }) {
  const { app, version } = useApp();
  const [all, setAll] = useState<TaskView[]>([]);
  const views = useMemo(() => (contextFilter === "all" ? all : all.filter((v) => v.record.task.contextId === contextFilter)), [all, contextFilter]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [feedEvents, setFeedEvents] = useState<Array<{ feed: CalendarFeed; ev: IcsEvent }>>([]);

  useEffect(() => {
    let live = true;
    app.inbox().then((v) => live && setAll(v));
    app.calendarFeeds().then(async (feeds) => {
      const all = await Promise.all(feeds.map(async (feed) => (await loadFeedEvents(feed)).events.map((ev) => ({ feed, ev }))));
      if (live) setFeedEvents(all.flat());
    });
    return () => {
      live = false;
    };
  }, [app, version]);

  const dayKey = useMemo(
    () => (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: displayZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)),
    [displayZone],
  );
  // Single-day tasks keyed by day (sorted by time); multi-day tasks (startAt day < deadline day) as spans.
  const { byDay, spans } = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { timeZone: displayZone, hour: "numeric", minute: "2-digit" });
    const byDay = new Map<string, Array<{ v: TaskView; time: string | null; long: string | null; sort: number }>>();
    const spans: Array<{ v: TaskView; startKey: string; endKey: string; time: string }> = [];
    for (const v of views) {
      const { deadline: d, startAt } = v.record.task;
      if (!d) continue;
      const endKey = d.kind === "date" ? d.date : dayKey(d.at);
      const endT = d.kind === "instant" ? fmt.format(new Date(d.at)) : null;
      const startKey = startAt ? dayKey(startAt) : endKey;
      const startT = startAt ? fmt.format(new Date(startAt)) : null;
      if (startKey < endKey) {
        spans.push({ v, startKey, endKey, time: [startT && `from ${startT}`, endT && `until ${endT}`].filter(Boolean).join(" · ") });
        continue;
      }
      const time = startT && endT ? `${startT} – ${endT}` : endT ?? startT;
      // week/day: say which end the time is when only one is known
      const long = startT && endT ? time : endT ? `due ${endT}` : startT ? `from ${startT}` : null;
      const sort = startAt ? Date.parse(startAt) : d.kind === "instant" ? Date.parse(d.at) : -1;
      byDay.set(endKey, [...(byDay.get(endKey) ?? []), { v, time, long, sort }]);
    }
    for (const list of byDay.values()) list.sort((a, b) => a.sort - b.sort);
    spans.sort((a, b) => a.startKey.localeCompare(b.startKey) || b.endKey.localeCompare(a.endKey));
    return { byDay, spans };
  }, [views, dayKey, displayZone]);

  // Feed events by day key; multi-day events repeat on each day (end is exclusive).
  const eventsByDay = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { timeZone: displayZone, hour: "numeric", minute: "2-digit" });
    const m = new Map<string, Array<{ id: string; title: string; color: string; time: string | null; sort: number }>>();
    for (const { feed, ev } of feedEvents) {
      const startKey = ev.allDay ? ev.start : dayKey(ev.start);
      const endKey = ev.allDay ? shiftKey(ev.end, -1) : dayKey(new Date(Date.parse(ev.end) - 1).toISOString()); // end is exclusive
      // ponytail: cap at 31 days; feeds don't ship month-long events
      for (let k = startKey, i = 0; k <= endKey && i < 31; k = shiftKey(k, 1), i++) {
        const time = ev.allDay ? null : k === startKey ? fmt.format(new Date(ev.start)) : null;
        m.set(k, [...(m.get(k) ?? []), { id: `${feed.id}:${ev.uid}:${k}`, title: ev.title, color: feed.color, time, sort: ev.allDay ? -2 : Date.parse(ev.start) }]);
      }
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort);
    return m;
  }, [feedEvents, dayKey, displayZone]);

  // Cells: month = full Sun–Sat rows around the month; week = one Sun–Sat row; day = a single column.
  const [sy, sm] = start.split("-").map(Number);
  const cols = range === "day" ? 1 : 7;
  const firstKey = range === "month" ? addDays(start, -new Date(Date.UTC(sy, sm - 1, 1)).getUTCDay()) : start; // Sunday first (Outlook convention)
  const total = range === "month" ? Math.ceil((daysBetween(firstKey, start) + new Date(Date.UTC(sy, sm, 0)).getUTCDate()) / 7) * 7 : cols;
  const cells = Array.from({ length: total }, (_, i) => {
    const key = addDays(firstKey, i);
    const d = new Date(key + "T00:00:00Z");
    return { key, n: d.getUTCDate(), inMonth: range !== "month" || key.slice(0, 7) === start.slice(0, 7), weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
  });
  const weeks = Array.from({ length: total / cols }, (_, w) => {
    const days = cells.slice(w * cols, w * cols + cols);
    const lo = days[0].key, hi = days[cols - 1].key;
    // ponytail: greedy lane packing per week; spans are few
    const lanes: string[] = [];
    const bars = spans
      .filter((sp) => sp.startKey <= hi && sp.endKey >= lo)
      .map((sp) => {
        const from = sp.startKey < lo ? 0 : days.findIndex((c) => c.key === sp.startKey);
        const to = sp.endKey > hi ? cols - 1 : days.findIndex((c) => c.key === sp.endKey);
        let lane = lanes.findIndex((busy) => busy < sp.startKey);
        if (lane < 0) lane = lanes.push("") - 1;
        lanes[lane] = sp.endKey;
        return { ...sp, from, to, lane, first: sp.startKey >= lo, last: sp.endKey <= hi };
      });
    return { days, bars, laneCount: lanes.length };
  });
  const today = dayKey(new Date().toISOString());
  const shortMonth = (key: string) => new Date(key + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });

  return (
    <div className={`flex flex-1 flex-col ${range === "day" ? "mx-auto w-full max-w-3xl" : ""}`}>
      <div className="grid border-t text-sm" style={{ borderColor: "var(--line)", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {weeks[0].days.map((c) => (
          <div key={c.key} className="px-2 py-1.5 text-center font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            {new Date(c.key + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-px border-t text-sm" style={{ background: "var(--line)", borderColor: "var(--line)" }}>
        {weeks.map(({ days, bars, laneCount }) => (
          <div key={days[0].key} className="relative grid flex-1 gap-px" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {bars.map((b) => (
              <button
                key={b.v.record.task.id}
                onClick={() => onOpen(b.v)}
                title={`${b.v.record.task.title} · ${b.time}`}
                className={`absolute z-10 h-6 truncate px-2 text-left text-xs leading-6 font-medium ${b.first ? "rounded-l" : ""} ${b.last ? "rounded-r" : ""}`}
                style={{ left: `calc(${(b.from / cols) * 100}% + ${PAD}px)`, width: `calc(${((b.to - b.from + 1) / cols) * 100}% - ${2 * PAD}px)`, top: 36 + b.lane * BAR, background: b.v.contextColor ?? "#999", color: "#fff", boxSizing: "border-box" }}
              >
                {b.first ? `${b.v.record.task.title}${b.time ? ` · ${b.time}` : ""}` : `↳ ${b.v.record.task.title}`}
              </button>
            ))}
            {days.map((c) => {
              const tasks = byDay.get(c.key) ?? [];
              const open = expanded === c.key;
              const shown = open || range !== "month" ? tasks : tasks.slice(0, 4);
              return (
                <div key={c.key} className={`flex min-h-28 flex-col ${c.inMonth ? "" : "opacity-40"}`} style={{ padding: PAD, background: c.key === today && range !== "month" ? "var(--accent-soft)" : c.weekend ? "var(--field)" : "var(--surface)" }}>
                  <div className="mb-1 flex justify-end">
                    <span
                      className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[15px] ${c.key === today ? "font-semibold" : ""}`}
                      style={c.key === today ? { background: "var(--accent)", color: "var(--surface)" } : { color: "var(--muted)" }}
                    >
                      {c.n === 1 ? `${shortMonth(c.key)} ${c.n}` : c.n}
                    </span>
                  </div>
                  <ul className={`flex flex-col ${range === "day" ? "gap-2" : "gap-0.5"}`} style={{ paddingTop: laneCount * BAR }}>
                    {(eventsByDay.get(c.key) ?? []).map((e) => (
                      <li key={e.id} className="truncate rounded px-1 text-xs" style={{ background: "var(--field)", color: "var(--muted)", borderLeft: `3px solid ${e.color}` }} title={[e.title, e.time].filter(Boolean).join(" · ")}>
                        {e.time ? `${e.time} ` : ""}{e.title}
                      </li>
                    ))}
                    {shown.map(({ v, time, long }) => (
                      <li key={v.record.task.id}>
                        {range === "day" ? (
                          <button
                            onClick={() => onOpen(v)}
                            className="day-card flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left hover:bg-[var(--accent-soft)]"
                            style={{ borderColor: "var(--line)", background: "var(--surface)", borderLeft: `4px solid ${v.contextColor ?? "#999"}` }}
                          >
                            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              <span className={`font-medium ${v.priority.overdue ? "text-danger" : ""}`}>{v.record.task.title}</span>
                              {long && <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>{long}</span>}
                            </span>
                            <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: "var(--muted)" }}>
                              <span>{v.contextName}</span>
                              <span>{remainingEffortText(v.priority)}</span>
                              <span>{labelText(v.priority)}</span>
                              {(v.record.task.tags ?? []).map((tag) => <span key={tag}>#{tag}</span>)}
                            </span>
                            {v.record.task.notes && <Markdown text={v.record.task.notes} className="mt-1 max-w-[65ch] text-sm" />}
                          </button>
                        ) : (
                          <button
                            onClick={() => onOpen(v)}
                            className={`flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[var(--accent-soft)] ${v.priority.overdue ? "text-danger" : ""}`}
                            title={[v.record.task.title, time].filter(Boolean).join(" · ")}
                          >
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: v.contextColor ?? "#999" }} />
                            <span className="min-w-0">
                              <span className="block truncate">{v.record.task.title}</span>
                              {(range === "week" ? long : time) && <span className="block text-xs tabular-nums" style={{ color: "var(--muted)" }}>{range === "week" ? long : time}</span>}
                            </span>
                          </button>
                        )}
                      </li>
                    ))}
                    {range === "month" && tasks.length > 4 && (
                      <li>
                        <button className="px-1 hover:underline" style={{ color: "var(--muted)" }} onClick={() => setExpanded(open ? null : c.key)}>
                          {open ? "Show less" : `+${tasks.length - 4} more`}
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
const BAR = 28; // px per span lane
const PAD = 6; // cell padding; span bars inset by the same amount
const shiftKey = (k: string, days: number) => new Date(Date.parse(k + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
