"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import type { TaskView } from "@/application/service";
import type { FocusStats } from "@/domain/stats";
import { deadlineText, labelText, minutesText, statusText } from "./format";
import { TaskDialog } from "./TaskDialog";

function ReviewActions({ view, onOpen }: { view: TaskView; onOpen: (v: TaskView) => void }) {
  const { app, refresh, announce } = useApp();
  const t = view.record.task;
  async function run(p: Promise<{ ok: boolean; error?: { message: string } }>, msg: string) {
    const r = await p;
    announce(r.ok ? msg : (r.error?.message ?? "Action failed."));
    refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
      <span className="mr-1 text-xs text-neutral-500">Still relevant?</span>
      <button className={ra} onClick={() => run(app.complete(t.id, t.revision), "Task completed.")}>Complete</button>
      <button className={ra} onClick={() => onOpen(view)}>Reschedule</button>
      <button className={ra} onClick={() => run(app.block(t.id, t.revision), "Task blocked.")}>Blocked</button>
      <button className={ra} onClick={() => run(app.noLongerNeeded(t.id, t.revision), "Archived — no longer needed.")}>No longer needed</button>
      <button className={ra} onClick={() => run(app.stillRelevant(t.id, t.revision), "Review postponed 7 days.")}>Still relevant</button>
    </div>
  );
}
const ra = "btn btn-sm";
const chip = "tag shrink-0";

type Filter = "unfinished" | "completed" | "archive" | "review";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "unfinished", label: "All unfinished" },
  { id: "completed", label: "Completed" },
  { id: "archive", label: "Archive" },
  { id: "review", label: "Review" },
];

interface SavedFilter {
  name: string;
  filter: Filter;
  search: string;
}
const SAVED_KEY = "focusgrid.savedFilters";
function loadSaved(): SavedFilter[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as SavedFilter[];
  } catch {
    return [];
  }
}

export function InboxView({
  displayZone,
  selectedId,
  onSelect,
}: {
  displayZone: string;
  selectedId: string | null; // owned by the shell so it lives in the URL
  onSelect: (id: string | null) => void;
}) {
  const onOpen = (v: TaskView) => onSelect(v.record.task.id);
  const { app, version, refresh, announce, aiCapability, t } = useApp();
  const [filter, setFilter] = useState<Filter>("unfinished");
  const [search, setSearch] = useState("");
  const [views, setViews] = useState<TaskView[] | null>(null);
  const [saved, setSaved] = useState<SavedFilter[]>(() => (typeof window === "undefined" ? [] : loadSaved()));
  const [stats, setStats] = useState<FocusStats | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const q = search || undefined;
    const load =
      filter === "completed"
        ? app.completed(q)
        : filter === "archive"
          ? app.archived(q)
          : filter === "review"
            ? app.review(q)
            : app.inbox(q);
    load.then((list) => {
      if (active) setViews(list);
    });
    if (filter === "completed") app.stats(displayZone).then((s) => active && setStats(s));
    app.inbox().then((all) => {
      if (!active) return;
      const tags = new Map<string, number>();
      for (const v of all) for (const tag of v.record.task.tags ?? []) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      setAllTags([...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k));
    });
    return () => {
      active = false;
    };
  }, [app, filter, search, version, displayZone]);

  const undoTitle = app.canUndo();

  function persistSaved(next: SavedFilter[]) {
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const maxDay = useMemo(() => Math.max(1, ...(stats?.days.map((d) => d.completed) ?? [1])), [stats]);

  const selected = views?.find((v) => v.record.task.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="view-bar">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          aria-label="Search tasks"
          className="min-w-0 flex-1 basis-64"
        />
        <div className="range-group" role="tablist" aria-label="Task views">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={filter === f.id ? "active" : ""}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={() => setBulk("")} className="btn">
          {t("bulkAdd")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="flex max-h-[45vh] min-h-0 flex-col overflow-auto border-b lg:max-h-none lg:w-[400px] lg:shrink-0 lg:border-b-0 lg:border-r xl:w-[440px]" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-col gap-4 px-5 pt-4 empty:hidden">

      {bulk != null && (
        <form
          className="panel max-w-3xl flex flex-col gap-3 p-4 text-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            const useAi = (e.currentTarget.elements.namedItem("ai") as HTMLInputElement | null)?.checked ?? false;
            const r = await app.captureBulk(bulk, displayZone, useAi);
            announce(`Added ${r.created} task(s)${r.failed ? `, ${r.failed} failed` : ""}.`);
            setBulk(null);
            refresh();
          }}
        >
          <label className="flex flex-col gap-1">
            <span>One task per line</span>
            <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} autoFocus />
          </label>
          <div className="flex items-center gap-3">
            {aiCapability.available && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="ai" /> Interpret each line with AI (deadline, estimate, context)
              </label>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => setBulk(null)} className={ra}>{t("cancel")}</button>
            <button type="submit" disabled={!bulk.trim()} className="btn btn-sm btn-primary">
              Add all
            </button>
          </div>
        </form>
      )}

      {(saved.length > 0 || search || filter !== "unfinished" || undoTitle) && (
      <div className="flex flex-wrap items-center gap-1.5">
        {saved.map((sf) => (
          <span key={sf.name} className="chip border-dashed">
            <button onClick={() => { setFilter(sf.filter); setSearch(sf.search); }} title={`${sf.filter} · ${sf.search}`}>★ {sf.name}</button>
            <button aria-label={`Remove saved filter ${sf.name}`} onClick={() => persistSaved(saved.filter((x) => x.name !== sf.name))}>×</button>
          </span>
        ))}
        {(search || filter !== "unfinished") && (
          <button
            className="link"
            onClick={() => {
              const name = window.prompt("Save this filter as", search || filter);
              if (name?.trim()) persistSaved([...saved.filter((x) => x.name !== name.trim()), { name: name.trim(), filter, search }].slice(-10));
            }}
          >
            Save filter
          </button>
        )}
        <span className="flex-1" />
        {undoTitle && (
          <button
            className="link"
            onClick={async () => {
              const r = await app.undoLast();
              announce(r.ok ? `Reverted “${r.value.title}”.` : r.error.message);
              refresh();
            }}
          >
            {t("undoLast")}
          </button>
        )}
      </div>
      )}

      {allTags.length > 0 && filter === "unfinished" && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSearch(search === `#${tag}` ? "" : `#${tag}`)}
              className={`chip py-0.5 text-[11px] ${search === `#${tag}` ? "chip-on" : ""}`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {filter === "completed" && stats && (
        <section className="panel max-w-3xl p-4 text-xs" aria-label="Focus statistics">
          <div className="flex flex-wrap gap-6">
            <span><strong className="text-base">{stats.streak}</strong> day streak</span>
            <span><strong className="text-base">{stats.completedTotal}</strong> completed</span>
            <span><strong className="text-base">{minutesText(stats.minutesSpent)}</strong> focused</span>
          </div>
          <div className="mt-3 flex h-10 items-end gap-0.5" aria-hidden>
            {stats.days.map((d) => (
              <span key={d.day} title={`${d.day}: ${d.completed}`} className="flex-1 rounded-sm" style={{ background: "var(--accent)", height: `${Math.max(6, (d.completed / maxDay) * 100)}%`, opacity: d.completed ? 1 : 0.15 }} />
            ))}
          </div>
          <p className="mt-1 text-neutral-500">Completions per day, last {stats.days.length} days.</p>
        </section>
      )}

      </div>

      {views == null ? (
        <p className="px-6 py-4 text-sm text-neutral-500">Loading…</p>
      ) : views.length === 0 ? (
        <div className="flex flex-col items-center gap-3 p-10 text-center text-sm">
          <p className="text-neutral-500">{search ? "No tasks match these filters." : filter === "unfinished" ? "Nothing here yet — add a task to get started." : "Nothing here yet."}</p>
          {search && (
            <button onClick={() => setSearch("")} className="btn btn-sm">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col border-t pb-4" style={{ borderColor: "var(--line)" }}>
          {views.map((v) => {
            const t = v.record.task;
            const st = statusText(t.status, v.priority.needsReview, v.deferred);
            return (
              <li key={t.id}>
                <button
                  onClick={() => onOpen(v)}
                  aria-current={t.id === selectedId ? "true" : undefined}
                  className={`flex w-full flex-col gap-0.5 text-left text-sm ${t.id === selectedId ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--field)]"}`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border"
                      style={{
                        background: v.contextColor ?? "transparent",
                        borderColor: v.contextColor ?? "#999",
                        opacity: t.progress > 0 ? 0.4 + t.progress * 0.6 : 1,
                      }}
                    />
                    <span className="truncate font-medium">{t.title}</span>
                    {st && <span className={chip}>{st}</span>}
                    {t.assignee && <span className={chip}>→ {t.assignee}</span>}
                    {v.blockerTitles.length > 0 && <span className={chip} title={v.blockerTitles.join(", ")}>Waiting on {v.blockerTitles.length}</span>}
                    {v.childCount > 0 && <span className={chip}>{v.childDone}/{v.childCount} subtasks</span>}
                    {t.recurrence && <span className={chip}>↻</span>}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {v.parentTitle ? `${v.parentTitle} › ` : ""}{v.contextName} · {labelText(v.priority)}
                    {(t.tags ?? []).length ? ` · ${t.tags!.map((x) => `#${x}`).join(" ")}` : ""}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {deadlineText(t.deadline, v.priority, displayZone)}
                    {t.progress > 0 && t.progress < 1 ? ` · ${Math.round(t.progress * 100)}% done` : ""}
                  </span>
                </button>
                {filter === "review" && <ReviewActions view={v} onOpen={onOpen} />}
              </li>
            );
          })}
        </ul>
      )}
      </section>

      <div className="grid-canvas flex min-w-0 flex-1 flex-col overflow-auto px-6 py-6 lg:px-10">
        {selected ? (
          <TaskDialog key={selected.record.task.id} inline mode="edit" view={selected} displayZone={displayZone} onClose={() => onSelect(null)} />
        ) : (
          <p className="m-auto text-sm text-neutral-500">Select a task to see its details.</p>
        )}
      </div>
      </div>
    </div>
  );
}
