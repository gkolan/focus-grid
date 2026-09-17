"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type DueRange, dueRangeShift, dueRangeStart, dueWindow, ymdIn } from "@/domain/deadline";
import { AppProvider, useApp } from "./AppProvider";
import { InboxView } from "./InboxView";
import { GridView } from "./GridView";
import { FocusView } from "./FocusView";
import { SettingsView } from "./SettingsView";
import { CalendarView } from "./CalendarView";
import { TaskDialog } from "./TaskDialog";
import { NotificationBell } from "./Notifications";
import { AssistantPanel } from "./AssistantPanel";
import { ThemePicker } from "./ThemePicker";
import { Icon } from "./icons";
import { detectZone } from "./format";
import type { TaskView } from "@/application/service";
import type { AiCapability } from "@/ai/config";

type Tab = "focus" | "grid" | "inbox" | "calendar" | "settings";
const TABS: readonly Tab[] = ["focus", "grid", "inbox", "calendar", "settings"];

/**
 * Deep links: `?view=focus`, `?task=<id>` (opens the editor), `?grid=<contextId>` (focus grid).
 * Local-first: a link opens that task in this browser's own database — it does not carry the data.
 */
function readUrl() {
  const q = new URLSearchParams(window.location.search);
  const view = q.get("view");
  return {
    view: TABS.includes(view as Tab) ? (view as Tab) : null,
    task: q.get("task"),
    category: q.get("category"),
    range: q.get("range"),
    at: q.get("at"),
  };
}
function writeUrl(patch: { view?: Tab; task?: string | null; category?: string | null; range?: string; at?: string | null }, push = false) {
  const q = new URLSearchParams(window.location.search);
  if (patch.view) q.set("view", patch.view);
  if (patch.task !== undefined) {
    if (patch.task) q.set("task", patch.task);
    else q.delete("task");
  }
  if (patch.category !== undefined) {
    if (patch.category && patch.category !== "all") q.set("category", patch.category);
    else q.delete("category");
  }
  if (patch.range) q.set("range", patch.range);
  if (patch.at !== undefined) {
    if (patch.at) q.set("at", patch.at);
    else q.delete("at");
  }
  const url = `${window.location.pathname}${q.size ? "?" + q : ""}`;
  if (url === window.location.pathname + window.location.search) return;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

const AI_COPY: Record<string, string> = {
  disabled: "AI capture is off. You can still add tasks manually.",
  config_invalid: "AI capture is unavailable. Save without AI.",
  deployment_blocked: "AI capture is unavailable. Save without AI.",
};

export function AppShell({ aiCapability, agent = false }: { aiCapability: AiCapability; agent?: boolean }) {
  return (
    <AppProvider aiCapability={aiCapability}>
      <Shell aiCapability={aiCapability} agent={agent} />
    </AppProvider>
  );
}

function Shell({ aiCapability, agent }: { aiCapability: AiCapability; agent: boolean }) {
  const { app, version, offerUndo, demo, announce, contexts, t, refresh } = useApp();
  const TAB_LABEL: Record<Tab, string> = { focus: t("focus"), grid: t("grid"), inbox: t("inbox"), calendar: t("calendar"), settings: t("settings") };
  // One grid per context ("Work", "Personal"…) or all of them; remembered per browser.
  const [contextFilter, setContextFilter] = useState<string>(() => {
    if (typeof window !== "undefined" && readUrl().category) return readUrl().category!;
    try { return localStorage.getItem("focusgrid.gridContext") ?? "all"; } catch { return "all"; }
  });
  useEffect(() => { writeUrl({ category: contextFilter }); }, [contextFilter]);
  // Time-range bar for Grid + Focus + Calendar: tasks due in the chosen day / week / month (undated always shown; overdue kept while the window holds today).
  const [range, setRangeState] = useState<DueRange>(() => {
    const u = typeof window !== "undefined" ? readUrl().range : null;
    if (u === "day" || u === "week" || u === "month") return u;
    try { const v = localStorage.getItem("focusgrid.gridRange"); return v === "day" || v === "month" ? v : "week"; } catch { return "week"; }
  });
  // period start ymd; null = the period containing today
  const [anchor, setAnchor] = useState<string | null>(() => (typeof window !== "undefined" && /^\d{4}-\d{2}-\d{2}$/.test(readUrl().at ?? "") ? readUrl().at : null));
  useEffect(() => { writeUrl({ range, at: anchor }); }, [range, anchor]);
  const showCompleted = true; // completed tasks stay visible (struck through) in every period
  const [counts, setCounts] = useState<{ done: number; total: number; undated: number } | null>(null);
  const [zone, setZone] = useState<string>(detectZone());
  const today = ymdIn(new Date(), zone);
  const start = anchor ?? dueRangeStart(range, today);
  const period = dueWindow(range, start, zone);
  // overdue tasks stay in the window that holds today
  const includeOverdue = start <= today && today < dueRangeShift(range, start, 1);
  const { start: dueStart, end: dueEnd } = period;
  const due = useMemo(() => ({ start: dueStart, end: dueEnd, includeOverdue }), [dueStart, dueEnd, includeOverdue]);
  const setRange = (v: DueRange) => {
    setRangeState(v);
    setAnchor(null);
    try { localStorage.setItem("focusgrid.gridRange", v); } catch {}
  };
  useEffect(() => {
    let live = true;
    app.gridCandidates({ contextIds: contextFilter === "all" ? undefined : [contextFilter], due, showCompleted: true }).then((d) => live && setCounts({ done: d.shown.filter((v) => v.record.task.status === "completed").length, total: d.total, undated: d.shown.filter((v) => !v.record.task.deadline && v.record.task.status !== "completed").length }));
    return () => { live = false; };
  }, [app, version, contextFilter, due]);
  // < 768 opens Focus; ≥ 768 opens Grid (UI-02). Route never changes on resize.
  const [tab, setTabState] = useState<Tab>(() =>
    typeof window === "undefined" ? "grid" : (readUrl().view ?? (window.innerWidth < 768 ? "focus" : "grid")),
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    writeUrl({ view: t }, true); // the selected task stays selected across views
  };
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1024,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [dialog, setDialog] = useState<{
    mode: "create" | "edit";
    view: TaskView | null;
    startInView?: boolean;
    captureProposal?: import("@/application/service").CaptureResult | null;
  } | null>(null);

  // The selected task (card on the grid, row in Focus, or the editor) is in the address bar,
  // so a task can be bookmarked or shared.
  const [taskId, setTaskIdState] = useState<string | null>(() => (typeof window === "undefined" ? null : readUrl().task));
  const setTaskId = (id: string | null) => {
    setTaskIdState(id);
    writeUrl({ task: id });
  };
  // a link to a task this browser doesn't have: say so once, then drop it
  useEffect(() => {
    if (!taskId) return;
    let live = true;
    app.allViews().then((views) => {
      if (live && !views.some((v) => v.record.task.id === taskId)) {
        announce("That task link points to a task this browser doesn't have.");
        setTaskId(null);
      }
    });
    return () => { live = false; };
  }, [app, version, taskId, announce]);
  useEffect(() => {
    const onPop = () => {
      const { view, task } = readUrl();
      if (view) setTabState(view);
      setTaskIdState(task);
      if (!task) setDialog(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openEdit = (v: TaskView) => {
    setTaskId(v.record.task.id);
    setDialog({ mode: "edit", view: v });
  };
  const openView = (v: TaskView) => {
    setTaskId(v.record.task.id);
    setDialog({ mode: "edit", view: v, startInView: true });
  };

  useEffect(() => {
    app.getSettings().then((s) => {
      if (s?.timeZone) setZone(s.timeZone);
      if (s) setSidebarPinned(s.sidebarPinned);
    });
  }, [app, version]);

  // If the task being edited disappears (deleted here or in another tab), close.
  useEffect(() => {
    if (dialog?.mode !== "edit" || !dialog.view) return;
    const id = dialog.view.record.task.id;
    app.allViews().then((views) => {
      if (!views.some((v) => v.record.task.id === id)) setDialog(null);
    });
  }, [app, version, dialog]);

  const openCreate = useCallback(() => setDialog({ mode: "create", view: null }), [setDialog]);

  const [taskCount, setTaskCount] = useState<number | null>(null);
  useEffect(() => {
    let stale = false; // a slow earlier query must not overwrite a newer count
    app.allViews().then((v) => { if (!stale) setTaskCount(v.length); });
    return () => { stale = true; };
  }, [app, version]);
  const firstRun = taskCount === 0;

  useEffect(() => {
    function isTyping(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      // Shortcuts only outside text entry / IME / dialogs (RED-99).
      if (e.isComposing || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      if (e.key === "a") {
        e.preventDefault();
        openCreate();
      } else if (e.key === "z" && (e.ctrlKey || e.metaKey) && app.canUndo()) {
        e.preventDefault();
        app.undoLast().then((r) => {
          announce(r.ok ? `Reverted “${r.value.title}”.` : r.error.message);
          refresh();
        });
      } else if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCreate, app, announce, refresh]);

  // First run: every view is empty until a task exists, so only Settings is offered.
  const nav = (firstRun ? (["settings"] as Tab[]) : (["grid", "focus", "calendar", "inbox", "settings"] as Tab[])).map((tb) => (
    <button
      key={tb}
      onClick={() => {
        setTab(tb);
        setMenuOpen(false);
      }}
      aria-current={tab === tb ? "page" : undefined}
      className="workspace-nav-item"
    >
      {TAB_LABEL[tb]}
    </button>
  ));

  return (
    <div className="workspace flex min-h-full flex-1 flex-col">
      <header className="workspace-header" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        {narrow ? (
          <button
            aria-label={`Menu — showing ${TAB_LABEL[tab]}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="header-icon"
          >
            <span aria-hidden>☰</span>
          </button>
        ) : (
          <div className="flex items-center">
            <button className="brand" aria-label="Home" title="Grid, this week" onClick={() => { setTab("grid"); setRange("week"); }}>FocusGrid</button>
            {!firstRun && <nav className="flex gap-1 text-sm">{nav.slice(0, 3)}</nav>}
          </div>
        )}
        <div className="header-center">
          {demo && (
            <button
              className="btn demo-chip"
              title="You're viewing sample data"
              onClick={async () => {
                const { clearDemo } = await import("@/application/repo");
                await clearDemo(); // every "Try demo" starts from the fresh fixture
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload required to open the live database
                window.location.href = "/";
              }}
            >
              Exit demo
            </button>
          )}
        </div>
        <div className="header-right">
          {!firstRun && (
            <button onClick={openCreate} aria-label="Add task" className="btn btn-primary add-task">
              <Icon name="plus" /><span className="label">Add task</span>
            </button>
          )}
          {agent && (
            <button onClick={() => setAssistantOpen((o) => !o)} aria-pressed={assistantOpen} aria-label="Assistant" title="Assistant" className="header-icon">
              <span aria-hidden>✦</span>
            </button>
          )}
          <div className="icon-group">
            {!firstRun && <NotificationBell />}
            {!narrow && (firstRun ? (["settings"] as Tab[]) : (["inbox", "settings"] as Tab[])).map((tb) => (
              <button key={tb} onClick={() => setTab(tb)} aria-current={tab === tb ? "page" : undefined} aria-label={TAB_LABEL[tb]} title={TAB_LABEL[tb]} className="header-icon">
                <Icon name={tb === "inbox" ? "inbox" : "gear"} />
              </button>
            ))}
          </div>
          {!narrow && <ThemePicker />}
        </div>
      </header>

      {narrow && menuOpen && (
        <>
          <button
            aria-hidden
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setMenuOpen(false)}
          />
          <nav className="mobile-nav text-sm" aria-label="Views">
            <span className="mb-2 px-3 pt-1 text-[17px] font-semibold tracking-tight" aria-hidden>FocusGrid</span>
            {nav}
            <div className="mt-auto"><ThemePicker /></div>
          </nav>
        </>
      )}

      <main className={`workspace-content view-${tab}`}>
      {firstRun && tab !== "settings" ? (
        <div className="empty-welcome mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-10 p-8 sm:flex-row sm:items-center sm:gap-14">
          <div className="flex flex-col items-center gap-4 text-center sm:items-start sm:text-left">
            <svg className="welcome-grid" viewBox="0 0 200 130" aria-hidden>
              <line x1="100" y1="6" x2="100" y2="124" />
              <line x1="6" y1="65" x2="194" y2="65" />
              <text x="12" y="20">Schedule</text>
              <text x="188" y="20" textAnchor="end">Do now</text>
              <text x="12" y="120">Ignore</text>
              <text x="188" y="120" textAnchor="end">Delegate</text>
              <circle cx="150" cy="30" r="5" className="hot" />
              <circle cx="172" cy="46" r="5" className="hot" />
              <circle cx="48" cy="40" r="5" />
              <circle cx="70" cy="52" r="5" />
              <circle cx="160" cy="92" r="5" />
              <circle cx="40" cy="100" r="5" />
            </svg>
            <p className="text-2xl font-medium">See what actually needs you</p>
            <p className="max-w-xs text-sm text-neutral-600">
              Every task lands on a field of importance and urgency, so the next thing to do is never a guess.
            </p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-3">
            {!demo && (
              <button
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload required to open the isolated demo database
                onClick={() => (window.location.href = "/?demo=1")}
                className="btn btn-primary welcome-cta"
              >
                <span>Explore the demo</span>
                <span className="welcome-cta-sub">60+ sample tasks, already prioritised</span>
              </button>
            )}
            <button onClick={openCreate} aria-label="Add a task" className="btn welcome-cta">
              <span>Start from scratch</span>
              <span className="welcome-cta-sub">Add your first task</span>
            </button>
            <p className="text-xs text-neutral-500">
              {demo ? "" : "Sample data lives in a separate space — your own tasks are never touched. "}
              Tasks stay in this browser; export a backup to keep a copy.
            </p>
          </div>
        </div>
      ) : tab === "focus" || tab === "grid" || tab === "calendar" ? (<>
        <div className="time-range-bar">
          {!counts ? <span /> : tab === "calendar" ? (
            <span className="task-count">{counts.undated ? `${counts.undated} undated task${counts.undated === 1 ? "" : "s"} not shown` : ""}</span>
          ) : (
            <span className="task-count" aria-label="Task counts">
              <strong>{counts.total - counts.done}</strong> open · {counts.done} done
            </span>
          )}
          <select
            aria-label="Category"
            className="grid-context"
            value={contexts.some((c) => c.id === contextFilter) ? contextFilter : "all"}
            onChange={(e) => {
              setContextFilter(e.target.value);
              try { localStorage.setItem("focusgrid.gridContext", e.target.value); } catch {}
            }}
          >
            <option value="all">All categories</option>
            {contexts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="range-controls">
            {anchor != null && anchor !== dueRangeStart(range, today) && (
              <button className="btn" onClick={() => setAnchor(null)}>Today</button>
            )}
            <div className="range-group" role="group" aria-label="Time range">
              {(["day", "week", "month"] as const).map((r) => (
                <button key={r} className={range === r ? "active" : ""} aria-pressed={range === r} onClick={() => setRange(r)}>
                  {{ day: "Today", week: "Week", month: "Month" }[r]}
                </button>
              ))}
            </div>
            <div className="range-group" aria-label="Period">
              <button onClick={() => setAnchor(dueRangeShift(range, start, -1))} aria-label="Previous period">‹</button>
              <span className="period-label">{period.label}</span>
              <button onClick={() => setAnchor(dueRangeShift(range, start, 1))} aria-label="Next period">›</button>
            </div>
          </div>
        </div>
        {tab === "calendar" ? (
        <CalendarView displayZone={zone} onOpen={openView} range={range} start={start} contextFilter={contextFilter} />
      ) : tab === "focus" ? (
        <FocusView
          displayZone={zone}
          contextFilter={contextFilter}
          due={due}
          showCompleted={showCompleted}
          selectedId={taskId}
          onSelect={setTaskId}
          onOpen={openEdit}
          toInbox={() => setTab("inbox")}
        />
      ) : (
        <GridView
          displayZone={zone}
          contextFilter={contextFilter}
          due={due}
          showCompleted={showCompleted}
          selectedId={taskId}
          onSelect={setTaskId}
          sidebarPinned={sidebarPinned}
          onOpen={openEdit}
        />)}
      </>) : tab === "inbox" ? (
        <InboxView
          displayZone={zone}
          selectedId={taskId}
          onSelect={setTaskId}
        />
      ) : (
        <SettingsView
          displayZone={zone}
          demo={demo}
          aiStatus={
            aiCapability.available
              ? aiCapability.mode === "fixture"
                ? "Demo interpretation — no AI request is sent."
                : "AI capture is available."
              : (AI_COPY[aiCapability.reason ?? "disabled"] ?? AI_COPY.disabled)
          }
        />
      )}
      </main>

      {dialog && (
        <TaskDialog
          key={dialog.view?.record.task.id ?? "create"}
          mode={dialog.mode}
          view={dialog.view}
          displayZone={zone}
          captureProposal={dialog.captureProposal}
          startInView={dialog.startInView}
          onClose={() => setDialog(null)}
          onCaptured={async (taskId, proposal) => {
            const v = (await app.allViews()).find((x) => x.record.task.id === taskId) ?? null;
            setTaskId(taskId);
            setDialog({ mode: "edit", view: v, captureProposal: proposal });
            offerUndo({
              label: "Task created from your capture.",
              run: () => app.undoCreate(taskId, proposal.revision),
            });
          }}
        />
      )}
      {assistantOpen && <AssistantPanel onClose={() => setAssistantOpen(false)} />}
    </div>
  );
}

