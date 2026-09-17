"use client";

import type { DueWindowFilter } from "@/domain/focus";
import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import type { TaskView } from "@/application/service";
import type { FocusEmptyReason } from "@/domain/focus";
import { importanceLabel, urgencyLabel, type PriorityResult } from "@/domain/priority";
import { deadlineText, labelText, minutesText, remainingEffortText } from "./format";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";
import { WORK_NOTE_MAX, type WorkEvent } from "@/domain/task";

type FocusState = {
  current: (TaskView & { rationale: string[] }) | null;
  emptyReason: FocusEmptyReason | null;
  recommendationChanged: boolean;
  startedPinned: boolean;
};

const QUADRANTS: Array<[PriorityResult["quadrant"], string]> = [
  ["do_now", "Do now"],
  ["schedule", "Schedule"],
  ["delegate", "Delegate"],
  ["ignore", "Ignore"],
];

const EMPTY_COPY: Record<FocusEmptyReason, { text: string; action: string }> = {
  empty_database: { text: "Nothing actionable right now.", action: "Review tasks" },
  no_actionable: { text: "Nothing actionable right now.", action: "Review tasks" },
  all_skipped: {
    text: "You’ve reviewed every available task for this session.",
    action: "Reset skipped tasks",
  },
  filter_empty: { text: "No tasks match this focus grid.", action: "Review tasks" },
};

export function FocusView({
  displayZone,
  contextFilter,
  due,
  showCompleted,
  selectedId,
  onSelect: setSelectedId,
  onOpen,
  toInbox,
}: {
  displayZone: string;
  contextFilter: string; // context id or "all" — the header's focus-grid picker
  due: DueWindowFilter | null; // time-range bar window or null
  showCompleted: boolean;
  selectedId: string | null; // owned by the shell so it lives in the URL
  onSelect: (id: string | null) => void;
  onOpen: (v: TaskView) => void;
  toInbox: () => void;
}) {
  const { app, version, refresh, announce } = useApp();
  const [state, setState] = useState<FocusState | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [list, setList] = useState<{ shown: TaskView[]; total: number } | null>(null);

  // Outlook-style: the list on the left follows the header filter, so does the recommendation.
  useEffect(() => {
    let live = true;
    app.focusSetContextFilter(contextFilter === "all" ? null : [contextFilter], due);
    Promise.all([
      app.gridCandidates({ contextIds: contextFilter === "all" ? undefined : [contextFilter], due, showCompleted }),
      app.focus(),
    ]).then(([d, s]) => {
      if (!live) return;
      setList(d);
      setState(s as FocusState);
    });
    return () => { live = false; };
  }, [app, version, contextFilter, due, showCompleted]);

  // tick once a second while a timer runs so "time spent" counts up
  const running = app.focusRunning();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  async function act(p: Promise<{ ok: boolean; error?: { message: string } }>, msg: string) {
    const r = await p;
    announce(r.ok ? msg : (r.error?.message ?? "Action failed."));
    refresh();
  }

  if (!state || !list) return <p className="p-6 text-sm text-neutral-500">Loading…</p>;

  const cur = state.current;
  const selected = list.shown.find((v) => v.record.task.id === selectedId) ?? cur;
  const isRecommended = selected != null && cur?.record.task.id === selected.record.task.id;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="flex max-h-[45vh] min-h-0 flex-col border-b lg:max-h-none lg:w-[400px] lg:shrink-0 lg:border-b-0 lg:border-r xl:w-[440px]" style={{ borderColor: "var(--line)" }}>
        <h2 className="px-5 pb-2 pt-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Tasks · {list.shown.length}
        </h2>
        {list.shown.length === 0 ? (
          <p className="px-5 py-6 text-sm text-neutral-500">No tasks match this period or category.</p>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-auto pb-4">
            {QUADRANTS.map(([q, name]) => {
              const rows = list.shown.filter((v) => v.priority.quadrant === q);
              if (!rows.length) return null;
              return (
                <section key={q} aria-label={name}>
                  <h3 className="px-5 pb-1 pt-4 text-[11px] uppercase tracking-wide text-neutral-500">{name}</h3>
                  <ul>
            {rows.map((v) => {
              const t = v.record.task;
              const sel = selected?.record.task.id === t.id;
              const rec = cur?.record.task.id === t.id;
              const spent = app.timeSpent(t);
              return (
                <li key={t.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    aria-current={sel ? "true" : undefined}
                    className={`flex w-full flex-col gap-0.5 px-5 py-3 text-left text-sm ${sel ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--field)]"}`}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: v.contextColor ?? "var(--muted)" }} />
                      <span className="truncate font-medium">{t.title}</span>
                      {rec && <span className="chip chip-on ml-auto shrink-0 py-0 text-[11px]">Up next</span>}
                      {v.waiting && <span className="chip ml-auto shrink-0 py-0 text-[11px]">{t.assignee ? `→ ${t.assignee}` : "Waiting"}</span>}
                      {running === t.id ? (
                        <Icon name="clock" className={`shrink-0 text-[var(--accent)] ${rec ? "" : "ml-auto"}`} />
                      ) : spent > 0 ? (
                        <span className={`shrink-0 text-xs tabular-nums text-neutral-500 ${rec ? "" : "ml-auto"}`}>{minutesText(spent)}</span>
                      ) : null}
                    </span>
                    <span className="pl-[18px] text-xs text-neutral-500">
                      {v.contextName} · {remainingEffortText(v.priority)} · {deadlineText(t.deadline, v.priority, displayZone)}
                      <span className="sr-only">. {labelText(v.priority)}. {minutesText(spent)} spent.</span>
                    </span>
                  </button>
                </li>
              );
            })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid-canvas flex min-w-0 flex-1 flex-col overflow-auto px-6 py-8 lg:px-12 lg:py-10">
        {selected == null ? (
          <div className="m-auto flex max-w-sm flex-col items-center text-center">
            <span className="welcome-mark" aria-hidden>✓</span>
            <p className="font-medium">{EMPTY_COPY[state.emptyReason ?? "no_actionable"].text}</p>
            <button
              className={`${fb} mt-4`}
              onClick={() => {
                if ((state.emptyReason ?? "no_actionable") === "all_skipped") {
                  app.focusResetSkipped();
                  refresh();
                } else toInbox();
              }}
            >
              {EMPTY_COPY[state.emptyReason ?? "no_actionable"].action}
            </button>
          </div>
        ) : (
          <FocusCard
            view={selected}
            rationale={isRecommended ? cur!.rationale : null}
            displayZone={displayZone}
            timeSpent={app.timeSpent(selected.record.task)}
            now={now}
            running={running === selected.record.task.id}
            pinned={isRecommended && state.startedPinned}
            changed={state.recommendationChanged}
            showWhy={showWhy}
            onWhy={() => setShowWhy((w) => !w)}
            onRefreshRec={async () => {
              await app.focusClearStarted();
              setSelectedId(null);
              refresh();
            }}
            onStart={async () => {
              await app.focusStart(selected.record.task.id);
              announce("Timer started.");
              refresh();
            }}
            onPause={async () => {
              await app.focusPause();
              announce("Timer paused.");
              refresh();
            }}
            onComplete={() => act(app.focusComplete(selected.record.task.id, selected.record.task.revision), "Task completed.")}
            onEditNote={(i, note) => act(app.editWorkNote(selected.record.task.id, selected.record.task.revision, i, note), note.trim() ? "Note saved." : "Note removed.")}
            onAddNote={(note, session) => act(app.addWorkNote(selected.record.task.id, selected.record.task.revision, note, session), "Note added.")}
            onSkip={async () => {
              await app.focusSkip(selected.record.task.id);
              announce("Skipped for this session.");
              setSelectedId(null);
              refresh();
            }}
            onBlock={() => act(app.focusBlock(selected.record.task.id, selected.record.task.revision), "Task blocked.")}
            onReschedule={() => onOpen(selected)}
          />
        )}
      </div>
    </div>
  );
}

function FocusCard({
  view,
  rationale,
  displayZone,
  timeSpent,
  now,
  running,
  pinned,
  changed,
  showWhy,
  onWhy,
  onRefreshRec,
  onStart,
  onPause,
  onComplete,
  onEditNote,
  onAddNote,
  onSkip,
  onBlock,
  onReschedule,
}: {
  view: TaskView;
  rationale: string[] | null; // only for the recommended task
  displayZone: string;
  timeSpent: number;
  now: number; // epoch ms, re-rendered each tick so a running session counts up
  running: boolean;
  pinned: boolean;
  changed: boolean;
  showWhy: boolean;
  onWhy: () => void;
  onRefreshRec: () => void;
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
  onEditNote: (index: number, note: string) => void;
  onAddNote: (note: string, session?: string) => void;
  onSkip: () => void;
  onBlock: () => void;
  onReschedule: () => void;
}) {
  const t = view.record.task;
  const p = view.priority;
  return (
    <div className="flex w-full max-w-5xl flex-col gap-8">
      {pinned && changed && (
        <div className="notice notice-info flex items-center justify-between text-xs">
          <span>Recommendations updated.</span>
          <button className="underline" onClick={onRefreshRec}>
            Show the new top task
          </button>
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* The task: where it sits, what it is, what we know */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="flex shrink-0 flex-col items-center gap-1">
              <MiniGrid urgency={p.urgency} importance={p.importance} tint={view.contextColor ?? "var(--accent)"} />
              <button className="text-xs text-neutral-500 underline" onClick={onWhy} aria-expanded={showWhy}>
                {showWhy ? "Hide details" : "Why here?"}
              </button>
            </div>
            <div className="min-w-0">
              <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: view.contextColor ?? "var(--muted)" }} />
                {view.contextName}
                {view.parentTitle && <span className="ml-2">· part of {view.parentTitle}</span>}
                {(t.tags ?? []).map((tag) => <span key={tag} className="chip py-0 text-[11px]">#{tag}</span>)}
              </p>
              <p className="text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">{t.title}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-neutral-500">
                <span className="flex items-center gap-1.5"><Icon name="clock" />{remainingEffortText(p)}</span>
                <span className={`flex items-center gap-1.5 ${p.overdue ? "text-danger" : ""}`}>
                  <Icon name={p.overdue ? "alert" : "calendar"} />{deadlineText(t.deadline, p, displayZone)}
                </span>
                <span className="flex items-center gap-1.5"><Icon name="gauge" />{labelText(p)}</span>
              </div>
            </div>
          </div>
          {t.notes && <Markdown text={t.notes} className="focus-notes text-sm" />}
          {view.waiting && (
            <p className="text-sm text-neutral-500">
              {t.assignee ? `Delegated to ${t.assignee} — not in Focus while assigned.` : `Waiting on: ${view.blockerTitles.join(", ")}.`}
            </p>
          )}
          {view.childCount > 0 && <p className="text-sm text-neutral-500">{view.childDone}/{view.childCount} subtasks done.</p>}
          {rationale && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Why now">
              {rationale.map((r, i) => (
                <li key={i} className="chip">{r}</li>
              ))}
            </ul>
          )}
          <WorkLog log={t.worklog ?? []} now={now} displayZone={displayZone} onEditNote={onEditNote} onAddNote={onAddNote} />
        </div>

        {/* The timer: its own panel, so the clock reads at a glance without dominating the task */}
        <div className="focus-timer">
          <div className={`focus-clock ${running ? "running" : ""}`} aria-live="off">
            <span className="tabular-nums">{clockText(timeSpent)}</span>
            <span className="focus-clock-label">{running ? "running" : timeSpent > 0 ? "spent" : "not started"}</span>
          </div>
          {running ? (
            <button className="btn btn-primary focus-primary" onClick={onPause}>Pause</button>
          ) : (
            <button className="btn btn-primary focus-primary" onClick={onStart}>{timeSpent > 0 ? "Resume" : "Start"}</button>
          )}
          <button className="focus-complete w-full" onClick={onComplete}><Icon name="check" /> Complete</button>
          <div className="grid grid-cols-3 gap-2">
            <button className={fb} onClick={onSkip}>Skip</button>
            <button className={fb} onClick={onBlock}>Blocked</button>
            <button className={fb} onClick={onReschedule}>Reschedule</button>
          </div>
        </div>
      </div>
      {showWhy && (
        <dl className="panel grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-xs">
          <dt className="text-neutral-500">Effective placement</dt>
          <dd>
            {importanceLabel(p.importance)} importance ({p.importance.toFixed(2)}),{" "}
            {urgencyLabel(p.urgency, p.timePressureDelta)} urgency ({p.urgency.toFixed(2)})
          </dd>
          <dt className="text-neutral-500">Automatic urgency</dt>
          <dd>
            {p.automaticUrgency.toFixed(3)}
            {t.userUrgencyOverride
              ? " — overridden by your pin; the pin is what places the point"
              : ""}
          </dd>
          <dt className="text-neutral-500">Importance source</dt>
          <dd>
            {t.userImportanceOverride
              ? "pinned by you"
              : `base value ${t.baseImportance} (${view.record.provenance.baseImportance.source})`}
          </dd>
          <dt className="text-neutral-500">Deadline</dt>
          <dd>{deadlineText(t.deadline, p, displayZone)}</dd>
          <dt className="text-neutral-500">Remaining effort</dt>
          <dd>{remainingEffortText(p)}</dd>
          <dt className="text-neutral-500">Pressure contributions</dt>
          <dd>
            deadline {p.deadlinePressure.toFixed(2)} · effort {p.effortPressure.toFixed(2)} · overdue{" "}
            {p.overduePressure.toFixed(2)}
          </dd>
          <dt className="text-neutral-500">Score</dt>
          <dd>{view.score.toFixed(4)} (importance 0.50, urgency 0.35, deadline 0.10, completion 0.05)</dd>
          <dt className="col-span-2 mt-1 text-neutral-400">
            FocusGrid only knows elapsed time — it does not model your calendar or claim you have
            enough time to finish.
          </dt>
        </dl>
      )}
    </div>
  );
}

/** Timer as mm:ss (or h:mm:ss past an hour). */
function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <textarea
        autoFocus
        rows={3}
        value={v}
        maxLength={WORK_NOTE_MAX}
        placeholder="What happened?"
        aria-label="Note"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={!v.trim() && !initial}>{initial ? "Save" : "Add note"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const ENTRY_ICON = { session: "clock", complete: "check", note: "pencil" } as const;

type Indexed = [number, WorkEvent];

function WorkLog({ log, now, displayZone, onEditNote, onAddNote }: { log: WorkEvent[]; now: number; displayZone: string; onEditNote: (i: number, note: string) => void; onAddNote: (note: string, session?: string) => void }) {
  const [composing, setComposing] = useState<null | "top" | string>(null); // "top" or a session start
  const [editing, setEditing] = useState<number | null>(null);
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: displayZone });
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: displayZone });
  const at = (e: WorkEvent) => (e.kind === "session" ? e.start : e.at);
  const today = day.format(new Date(now));
  const indexed: Indexed[] = log.map((e, i) => [i, e]);
  type Note = Extract<WorkEvent, { kind: "note" }>;
  const childrenOf = (start: string) => indexed.filter((x): x is [number, Note] => x[1].kind === "note" && x[1].session === start);
  // top level = sessions, completions, unlinked notes; newest first, grouped by day
  const groups: { label: string; items: Indexed[] }[] = [];
  for (const it of indexed.filter(([, e]) => !(e.kind === "note" && e.session)).reverse()) {
    const label = day.format(new Date(at(it[1])));
    const g = groups.at(-1);
    if (g && g.label === label) g.items.push(it);
    else groups.push({ label, items: [it] });
  }
  const open = (key: "top" | string) => { setComposing(key); setEditing(null); };

  const note = (i: number, e: Note) =>
    editing === i ? (
      <NoteEditor initial={e.note} onSave={(v) => { onEditNote(i, v); setEditing(null); }} onCancel={() => setEditing(null)} />
    ) : (
      <button className="w-full whitespace-pre-wrap text-left" onClick={() => { setEditing(i); setComposing(null); }} title="Edit note">{e.note}</button>
    );

  return (
    <section className="flex flex-col gap-3 border-t pt-5 text-sm" style={{ borderColor: "var(--line)" }} aria-label="Activity">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Activity</h3>
        {composing !== "top" && <button className="btn btn-sm" onClick={() => open("top")}><Icon name="plus" /> Note</button>}
      </div>
      {composing === "top" && <NoteEditor initial="" onSave={(v) => { onAddNote(v); setComposing(null); }} onCancel={() => setComposing(null)} />}
      {log.length === 0 && !composing && <p className="text-neutral-500">Nothing logged yet. Start the timer or add a note.</p>}
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-2">
          <p className="text-xs text-neutral-500">{g.label === today ? "Today" : g.label}</p>
          <ol className="flex flex-col">
            {g.items.map(([i, e]) => {
              const d = new Date(at(e));
              return (
                <li key={i} className="grid grid-cols-[auto_1fr_auto] gap-x-3 py-1.5">
                  <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
                    <Icon name={ENTRY_ICON[e.kind]} className="h-3.5 w-3.5 text-neutral-500" />
                  </span>
                  <div className="min-w-0">
                    {e.kind === "session" && (
                      <>
                        <p className="group flex items-baseline gap-2">
                          <span>
                            <span className="font-medium">{e.end ? "Worked" : "Working"}</span>{" "}
                            <span className="tabular-nums">{clockText(Math.max(0, (e.end ? Date.parse(e.end) : now) - Date.parse(e.start)) / 60_000)}</span>
                            <span className="text-neutral-500"> · {time.format(d)} – {e.end ? time.format(new Date(e.end)) : "now"}</span>
                          </span>
                          {composing !== e.start && (
                            <button className="text-xs text-neutral-500 underline-offset-2 hover:underline" onClick={() => open(e.start)}>+ Note</button>
                          )}
                        </p>
                        {(childrenOf(e.start).length > 0 || composing === e.start) && (
                          <ol className="mt-1.5 flex flex-col gap-1.5 border-l pl-3" style={{ borderColor: "var(--line)" }}>
                            {childrenOf(e.start).map(([ci, ce]) => (
                              <li key={ci} className="flex items-baseline gap-3">
                                <div className="min-w-0 flex-1">{note(ci, ce)}</div>
                                <span className="text-xs tabular-nums text-neutral-500">{time.format(new Date(ce.at))}</span>
                              </li>
                            ))}
                            {composing === e.start && (
                              <li><NoteEditor initial="" onSave={(v) => { onAddNote(v, e.start); setComposing(null); }} onCancel={() => setComposing(null)} /></li>
                            )}
                          </ol>
                        )}
                      </>
                    )}
                    {e.kind === "complete" && <p className="font-medium">Completed</p>}
                    {e.kind === "note" && note(i, e)}
                  </div>
                  <span className="text-xs tabular-nums text-neutral-500">{time.format(d)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}

function clockText(minutes: number): string {
  const total = Math.floor(minutes * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Where this task sits on the field — the same picture as the Grid, 72px wide. */
function MiniGrid({ urgency, importance, tint }: { urgency: number; importance: number; tint: string }) {
  const x = 20 + urgency * 18;
  const y = 20 - importance * 18;
  return (
    <svg aria-hidden viewBox="0 0 40 40" className="h-18 w-18 shrink-0">
      <rect x={0.5} y={0.5} width={39} height={39} rx={4} fill="var(--surface)" stroke="var(--line)" />
      <line x1={20} y1={2} x2={20} y2={38} stroke="var(--axis)" strokeWidth={0.75} />
      <line x1={2} y1={20} x2={38} y2={20} stroke="var(--axis)" strokeWidth={0.75} />
      <circle cx={x} cy={y} r={3.5} fill={tint} />
    </svg>
  );
}

const fb = "btn";
