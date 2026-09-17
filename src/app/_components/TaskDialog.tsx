"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import type { CaptureResult, TaskView } from "@/application/service";
import type { ImportanceChoice } from "@/application/service";
import type { Deadline } from "@/domain/task";
import type { TaskPatch } from "@/domain/commands";
import { zonedWallTimeToUtc } from "@/domain/deadline";
import { calculatePriority } from "@/domain/priority";
import { deadlineText, labelText, remainingEffortText } from "./format";
import { Markdown } from "./Markdown";
import { Icon } from "./icons";
import type { Recurrence } from "@/domain/task";
import type { TaskTemplate } from "@/persistence/schema";

type DeadlineKind = "none" | "date" | "timed";

interface DraftState {
  title: string;
  notes: string;
  deadlineKind: DeadlineKind;
  dateValue: string; // yyyy-mm-dd
  timedValue: string; // yyyy-mm-ddThh:mm
  estimate: string;
  contextId: string;
  importance: ImportanceChoice;
  importanceTouched: boolean;
  startValue: string; // yyyy-mm-ddThh:mm or ""
  recEvery: string;
  recUnit: Recurrence["unit"] | "never";
  parentId: string;
  blockedByIds: string[];
  assignee: string;
  tags: string;
}

function emptyDraft(): DraftState {
  return {
    title: "",
    notes: "",
    deadlineKind: "none",
    dateValue: "",
    timedValue: "",
    estimate: "",
    contextId: "",
    importance: "medium",
    importanceTouched: false,
    startValue: "",
    recEvery: "1",
    recUnit: "never",
    parentId: "",
    blockedByIds: [],
    assignee: "",
    tags: "",
  };
}

/** Local wall time (yyyy-mm-ddThh:mm) → UTC ISO via the display zone, or a field error. */
function localToUtc(value: string, zone: string): { iso: string } | { fieldError: string } {
  const [d, t] = value.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const r = zonedWallTimeToUtc(y, mo, da, h, mi, 0, zone);
  if (r.outcome === "nonexistent") return { fieldError: "That local time does not exist (clocks skip forward). Pick another time." };
  if (r.outcome === "ambiguous") return { fieldError: "That local time occurs twice (clocks fall back). Pick a time outside the repeated hour." };
  return { iso: new Date(r.utc).toISOString() };
}

function utcToLocal(iso: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

function draftExtras(d: DraftState): Pick<TaskPatch, "recurrence" | "parentId" | "blockedByIds" | "assignee" | "tags"> {
  return {
    recurrence: d.recUnit === "never" ? null : { every: Math.max(1, Math.min(365, Number(d.recEvery) || 1)), unit: d.recUnit },
    parentId: d.parentId || null,
    blockedByIds: d.blockedByIds,
    assignee: d.assignee.trim() || null,
    tags: d.tags.split(/[,;]/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
  };
}

export function TaskDialog({
  mode,
  view,
  displayZone,
  captureProposal,
  startInView,
  inline,
  onClose,
  onCaptured,
}: {
  mode: "create" | "edit";
  view: TaskView | null;
  displayZone: string;
  captureProposal?: CaptureResult | null;
  /** Open read-only with Complete / Edit at the top (Calendar); Edit switches to the form. */
  startInView?: boolean;
  /** Render the form in place (Inbox detail pane) instead of as a modal. */
  inline?: boolean;
  onClose: () => void;
  onCaptured?: (taskId: string, proposal: CaptureResult) => void;
}) {
  const { app, contexts, aiCapability, refresh, announce, offerUndo, t } = useApp();
  const [interpreting, setInterpreting] = useState(false);
  const [openTasks, setOpenTasks] = useState<TaskView[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  useEffect(() => {
    app.inbox().then(setOpenTasks);
    app.templates().then(setTemplates);
  }, [app]);
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<DraftState>(() =>
    view ? draftFromView(view, displayZone) : emptyDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState<TaskView | null>(null);
  const [viewing, setViewing] = useState(!!startInView && mode === "edit");
  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (!inline) ref.current?.showModal();
  }, [inline]);

  const revision = view?.record.task.revision ?? 0;
  const task = view?.record.task;
  const readOnlyFields = task?.status === "completed";

  function buildDeadline(): { deadline: Deadline | null } | { fieldError: string } {
    if (draft.deadlineKind === "none") return { deadline: null };
    if (draft.deadlineKind === "date") {
      if (!draft.dateValue) return { fieldError: "Choose a date or select “No deadline”." };
      return { deadline: { kind: "date", date: draft.dateValue, timeZone: displayZone } };
    }
    if (!draft.timedValue) return { fieldError: "Choose a date and time." };
    const r = localToUtc(draft.timedValue, displayZone);
    if ("fieldError" in r) return r;
    return { deadline: { kind: "instant", at: r.iso, timeZone: displayZone } };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const dl = buildDeadline();
    if ("fieldError" in dl) {
      setError(dl.fieldError);
      return;
    }
    const estimate = draft.estimate.trim() === "" ? null : Number(draft.estimate);
    if (estimate !== null && (!Number.isInteger(estimate) || estimate < 1)) {
      setError("Estimate must be a whole number of minutes (1 or more), or left blank.");
      return;
    }
    let startAt: string | null = null;
    if (draft.startValue) {
      const r = localToUtc(draft.startValue, displayZone);
      if ("fieldError" in r) {
        setError(r.fieldError);
        return;
      }
      startAt = r.iso;
    }
    setPending(true);
    try {
      if (mode === "create") {
        const res = await app.createManualTask({
          title: draft.title,
          notes: draft.notes,
          deadline: dl.deadline,
          startAt,
          estimatedMinutes: estimate,
          contextId: draft.contextId || null,
          importance: draft.importanceTouched ? draft.importance : "untouched",
          ...draftExtras(draft),
        });
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
        announce("Task saved.");
        refresh();
        const { id, revision: rev } = res.value;
        offerUndo({
          label: "New task added.",
          run: () => app.undoCreate(id, rev),
        });
        close();
      } else if (task) {
        const patch: TaskPatch = { title: draft.title, notes: draft.notes, ...draftExtras(draft) };
        if (!readOnlyFields) {
          patch.deadline = dl.deadline;
          patch.startAt = startAt;
          patch.estimatedMinutes = estimate;
          patch.contextId = draft.contextId || null;
        }
        const res = await app.edit(task.id, revision, patch);
        if (!res.ok) {
          if (res.error.code === "CONFLICT") {
            const latest = (await app.inbox()).find((v) => v.record.task.id === task.id) ?? null;
            setConflict(latest);
            setError("This task changed in another tab. Review the latest version before saving.");
          } else {
            setError(res.error.message);
          }
          return;
        }
        announce("Task saved.");
        refresh();
        close();
      }
    } finally {
      setPending(false);
    }
  }

  function close() {
    ref.current?.close();
    onClose();
  }

  async function runLifecycle(fn: () => Promise<{ ok: boolean; error?: { message: string } }>, label: string) {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      setError(res.error?.message ?? "That action could not be completed.");
      return;
    }
    announce(label);
    refresh();
    close();
  }

  const preview = useMemo(() => {
    if (!task) return null;
    return calculatePriority(task, new Date());
  }, [task]);

  const body = (
    <form onSubmit={submit} className="flex flex-col gap-5 p-6">
        <div className="form-main flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate">{mode === "create" ? t("addATask") : viewing ? task?.title : t("editTask")}</h2>
          {mode === "edit" && view && (
            <button
              type="button"
              className="link"
              onClick={async () => {
                // the address bar already carries ?task=<id>; this just puts it on the clipboard
                const url = new URL(window.location.href);
                url.searchParams.set("task", view.record.task.id);
                try {
                  await navigator.clipboard.writeText(url.toString());
                  announce("Link copied. It opens this task in this browser.");
                } catch {
                  announce(url.toString());
                }
              }}
            >
              Copy link
            </button>
          )}
        </div>

        {viewing && view && task ? (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {([
                ["Due", <><Icon name={view.priority.overdue ? "alert" : "calendar"} />{deadlineText(task.deadline, view.priority, displayZone)}</>],
                ["Category", <><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: view.contextColor ?? "var(--muted)" }} />{view.contextName}</>],
                ["Effort", <><Icon name="clock" />{remainingEffortText(view.priority)}</>],
                ["Priority", <><Icon name="gauge" />{labelText(view.priority)}</>],
              ] as const).map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>{k}</dt>
                  <dd className="flex items-center gap-1.5">{v}</dd>
                </Fragment>
              ))}
            </dl>
            {task.notes && <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}><Markdown text={task.notes} className="max-w-[65ch]" /></div>}
            {error && <p role="alert" className="text-danger text-sm">{error}</p>}
            <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
              <button type="button" className="btn" title="Edit task" onClick={() => setViewing(false)}>
                <Icon name="pencil" /> Edit
              </button>
              <span className="flex-1" />
              <button type="button" className="btn" onClick={close}>Close</button>
              {task.status !== "completed" && task.status !== "archived" && (
                <button type="button" className="btn btn-primary" disabled={pending} title="Mark complete" onClick={() => runLifecycle(() => app.complete(task.id, revision), "Task completed.")}>
                  <Icon name="check" /> Complete
                </button>
              )}
            </div>
          </div>
        ) : (<>
        {mode === "create" && templates.length > 0 && (
          <label className="flex items-center gap-3 text-sm">
            <span>{t("template")}</span>
            <select
              defaultValue=""
              aria-label={t("template")}
              onChange={(e) => {
                const tp = templates.find((x) => x.id === e.target.value);
                if (!tp) return;
                setDraft((d) => ({
                  ...d,
                  title: tp.title,
                  notes: tp.notes,
                  estimate: tp.estimatedMinutes == null ? "" : String(tp.estimatedMinutes),
                  contextId: tp.contextId ?? "",
                  recEvery: String(tp.recurrence?.every ?? 1),
                  recUnit: tp.recurrence?.unit ?? "never",
                  tags: tp.tags.join(", "),
                }));
              }}
            >
              <option value="">—</option>
              {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
          </label>
        )}

        {captureProposal && task && (
          <CapturePanel
            proposal={captureProposal}
            taskId={task.id}
            onDone={close}
          />
        )}

        {error && (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        )}
        {conflict && (
          <div className="notice notice-warn">
            <p className="font-medium">Latest saved version</p>
            <p>Title: {conflict.record.task.title}</p>
            <button
              type="button"
              className="btn btn-sm mt-2"
              onClick={() => {
                setDraft((d) => ({ ...d, title: conflict.record.task.title, notes: conflict.record.task.notes }));
                setConflict(null);
                setError(null);
              }}
            >
              Load latest into form
            </button>
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span>Title <span className="text-danger">*</span></span>
          <input
            required
            maxLength={400}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Notes</span>
          <textarea
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
          />
        </label>

        <fieldset className="flex flex-col gap-2 text-sm" disabled={readOnlyFields}>
          <legend className="mb-1">Deadline</legend>
          <div className="flex flex-wrap gap-4">
            {(["none", "date", "timed"] as DeadlineKind[]).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="deadlineKind"
                  checked={draft.deadlineKind === k}
                  onChange={() => set("deadlineKind", k)}
                />
                {k === "none" ? "No deadline" : k === "date" ? "A day" : "A day & time"}
              </label>
            ))}
          </div>
          {draft.deadlineKind === "date" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={draft.dateValue}
                onChange={(e) => set("dateValue", e.target.value)}
              />
              <span className="text-xs text-neutral-500">Time zone: {displayZone}</span>
            </div>
          )}
          {draft.deadlineKind === "timed" && (
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={draft.timedValue}
                onChange={(e) => set("timedValue", e.target.value)}
              />
              <span className="text-xs text-neutral-500">{displayZone}</span>
            </div>
          )}
          {readOnlyFields && (
            <p className="text-xs text-neutral-500">Reopen the task to change its deadline.</p>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>Estimate (minutes)</span>
            <input
              inputMode="numeric"
              value={draft.estimate}
              disabled={readOnlyFields}
              onChange={(e) => set("estimate", e.target.value)}
              placeholder="optional"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Context</span>
            <select
              value={draft.contextId}
              disabled={readOnlyFields}
              onChange={(e) => set("contextId", e.target.value)}
            >
              <option value="">Uncategorized</option>
              {contexts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <details className="text-sm" open={mode === "edit" && (draft.recUnit !== "never" || !!draft.parentId || draft.blockedByIds.length > 0 || !!draft.assignee || !!draft.tags || !!draft.startValue)}>
          <summary className="cursor-pointer text-neutral-600">More: start date, repeat, project, waiting on, delegate, tags</summary>
          <div className="mt-3 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span>{t("startDate")}</span>
                <input type="datetime-local" value={draft.startValue} disabled={readOnlyFields} onChange={(e) => set("startValue", e.target.value)} />
                <span className="text-xs text-neutral-500">Hidden from Focus until then ({displayZone}).</span>
              </label>
              <label className="flex flex-col gap-1">
                <span>{t("repeats")}</span>
                <span className="flex items-center gap-1">
                  <select value={draft.recUnit} onChange={(e) => set("recUnit", e.target.value as DraftState["recUnit"])} aria-label="Repeat unit">
                    <option value="never">{t("never")}</option>
                    <option value="day">Every N days</option>
                    <option value="week">Every N weeks</option>
                    <option value="month">Every N months</option>
                  </select>
                  {draft.recUnit !== "never" && (
                    <input inputMode="numeric" value={draft.recEvery} onChange={(e) => set("recEvery", e.target.value)} className="w-20" aria-label="Repeat every" />
                  )}
                </span>
                <span className="text-xs text-neutral-500">Completing creates the next occurrence.</span>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span>{t("parent")}</span>
                <select value={draft.parentId} onChange={(e) => set("parentId", e.target.value)}>
                  <option value="">—</option>
                  {openTasks.filter((v) => v.record.task.id !== task?.id && v.record.task.parentId !== task?.id).map((v) => (
                    <option key={v.record.task.id} value={v.record.task.id}>{v.record.task.title}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span>{t("assignee")}</span>
                <input value={draft.assignee} onChange={(e) => set("assignee", e.target.value)} placeholder="name or email" maxLength={120} />
                <span className="text-xs text-neutral-500">Delegated tasks stay on the field but leave Focus.</span>
              </label>
              <label className="flex flex-col gap-1">
                <span>{t("tags")}</span>
                <input value={draft.tags} onChange={(e) => set("tags", e.target.value)} placeholder="comma, separated" />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span>{t("blockedBy")} <span className="text-xs text-neutral-500">(ctrl/cmd-click for several)</span></span>
              <select
                multiple
                size={Math.min(5, Math.max(2, openTasks.length))}
                value={draft.blockedByIds}
                onChange={(e) => set("blockedByIds", [...e.target.selectedOptions].map((o) => o.value))}
               
              >
                {openTasks.filter((v) => v.record.task.id !== task?.id).map((v) => (
                  <option key={v.record.task.id} value={v.record.task.id}>{v.record.task.title}</option>
                ))}
              </select>
            </label>
          </div>
        </details>

        {mode === "create" && (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1">Importance</legend>
            <div className="flex gap-4">
              {(["low", "medium", "high"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="importance"
                    checked={draft.importance === v}
                    onChange={() => setDraft((d) => ({ ...d, importance: v, importanceTouched: true }))}
                  />
                  {v[0].toUpperCase() + v.slice(1)}
                  {v === "medium" && !draft.importanceTouched ? " (default)" : ""}
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-500">
              Leaving this on Medium keeps importance automatic. Choosing any option (including
              Medium) pins importance; you can reset it later.
            </p>
          </fieldset>
        )}

        {mode === "edit" && task && preview && (
          <EditExtras
            task={task}
            preview={preview}
            displayZone={displayZone}
            pending={pending}
            onError={setError}
            onDone={close}
          />
        )}

        </>)}
        </div>

        {!viewing && (
        <div className="form-actions flex flex-wrap items-center justify-end gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
          {mode === "edit" && task && task.status !== "completed" && task.status !== "archived" && (
            <button type="button" className="btn btn-primary form-complete" disabled={pending} title="Mark complete" onClick={() => runLifecycle(() => app.complete(task.id, revision), "Task completed.")}>
              <Icon name="check" /> Complete
            </button>
          )}
          {mode === "edit" && task && task.status !== "archived" && (
            <>
              {task.status === "active" && (
                <button type="button" className={btn} disabled={pending} onClick={() => runLifecycle(() => app.block(task.id, revision), "Task blocked.")}>
                  Block
                </button>
              )}
              {task.status === "blocked" && (
                <button type="button" className={btn} disabled={pending} onClick={() => runLifecycle(() => app.unblock(task.id, revision), "Task unblocked.")}>
                  Unblock
                </button>
              )}
              {task.status === "completed" && (
                <button type="button" className={btn} disabled={pending} onClick={() => runLifecycle(() => app.reopen(task.id, revision), "Task reopened.")}>
                  Reopen
                </button>
              )}
              <button type="button" className={btn} disabled={pending} onClick={() => runLifecycle(() => app.archive(task.id, revision), "Task archived.")}>
                Archive
              </button>
            </>
          )}
          {mode === "edit" && task && task.status === "archived" && (
            <button type="button" className={btn} disabled={pending} onClick={() => runLifecycle(() => app.restore(task.id, revision), "Task restored.")}>
              Restore
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            className={`${btn} form-cancel`}
            onClick={() => {
              app.cancelCapture();
              close();
            }}
          >
            Cancel
          </button>
          {mode === "create" && aiCapability.available && (
            <button
              type="button"
              className={btn}
              disabled={interpreting || pending || draft.title.trim().length === 0}
              onClick={async () => {
                setError(null);
                setInterpreting(true);
                const res = await app.captureWithAI(draft.title.trim(), displayZone);
                setInterpreting(false);
                if (res.ok) {
                  announce("Task created from your capture.");
                  refresh();
                  // The parent swaps this dialog for the edit dialog (keyed
                  // remount); do NOT call ref.close() here or its `close` event
                  // races the parent's setDialog.
                  onCaptured?.(res.result.taskId, res.result);
                } else {
                  setError(`${res.message} (You can still Save without AI.)`);
                }
              }}
            >
              {interpreting ? "Interpreting…" : "Interpret with AI"}
            </button>
          )}
          <button type="submit" className={btnPrimary} disabled={pending || interpreting}>
            {pending ? "Saving…" : mode === "create" && aiCapability.available ? "Save without AI" : "Save"}
          </button>
        </div>
        )}
      </form>
  );

  const label = mode === "create" ? "Add a task" : "Edit task";
  if (inline) {
    return (
      <section aria-label={label} className="task-inline">
        {body}
      </section>
    );
  }
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto max-h-[92dvh] w-[min(40rem,96vw)] overflow-y-auto p-0"
      aria-label={label}
    >
      {body}
    </dialog>
  );
}

function CapturePanel({
  proposal,
  taskId,
  onDone,
}: {
  proposal: CaptureResult;
  taskId: string;
  onDone: () => void;
}) {
  const { app, refresh, announce } = useApp();
  const [pending, proposalFields] = [false, proposal.fields];
  const [done, setDone] = useState<Set<string>>(new Set());
  const applied = proposalFields.filter((f) => f.applied);
  const pendingFields = proposalFields.filter(
    (f) => (f.needsAcceptance || f.ambiguity) && f.applicable && !done.has(f.key),
  );

  async function accept(key: string, value: unknown) {
    const rec = await app.allViews();
    const t = rec.find((v) => v.record.task.id === taskId)?.record.task;
    if (!t) return;
    const r = await app.acceptCaptureField(taskId, t.revision, key as never, value);
    if (r.ok) {
      announce("Applied.");
      setDone((d) => new Set(d).add(key));
      refresh();
    } else {
      announce(r.error.message);
    }
  }

  return (
    <div className="notice notice-info text-sm">
      <p className="font-medium">Capture interpretation</p>
      {proposal.multiTaskNotice && (
        <p className="text-xs text-neutral-600">
          FocusGrid captures one task at a time — the full text is kept in Notes.
        </p>
      )}
      {applied.length > 0 && (
        <p className="mt-1 text-xs text-neutral-600">
          Applied automatically:{" "}
          {applied.map((f) => `${f.key}${f.inferred ? " (inferred)" : ""}`).join(", ")}.
        </p>
      )}
      {pendingFields.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1">
          {pendingFields.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center gap-2">
              <span className="text-xs">
                <strong>{f.key}</strong>:{" "}
                {f.ambiguity ? f.ambiguity : JSON.stringify(f.value)}
                {f.sourceText ? ` — from “${f.sourceText}”` : ""}
                {f.key === "baseUrgency" ? " (urgency always needs your OK)" : ""}
              </span>
              {f.value != null && !f.ambiguity && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={pending}
                  onClick={() => accept(f.key, f.value)}
                >
                  Accept
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-neutral-500">Nothing else to confirm.</p>
      )}
      <button
        type="button"
        className="link mt-2"
        onClick={onDone}
      >
        Done
      </button>
    </div>
  );
}

const btn = "btn";
const btnPrimary = "btn btn-primary";

function draftFromView(v: TaskView, zone: string): DraftState {
  const t = v.record.task;
  const d = emptyDraft();
  d.title = t.title;
  d.notes = t.notes;
  d.estimate = t.estimatedMinutes == null ? "" : String(t.estimatedMinutes);
  d.contextId = t.contextId ?? "";
  d.importance = "medium";
  d.importanceTouched = false;
  if (t.deadline?.kind === "date") {
    d.deadlineKind = "date";
    d.dateValue = t.deadline.date;
  } else if (t.deadline?.kind === "instant") {
    d.deadlineKind = "timed";
    d.timedValue = utcToLocal(t.deadline.at, zone);
  }
  d.startValue = t.startAt ? utcToLocal(t.startAt, zone) : "";
  d.recEvery = String(t.recurrence?.every ?? 1);
  d.recUnit = t.recurrence?.unit ?? "never";
  d.parentId = t.parentId ?? "";
  d.blockedByIds = t.blockedByIds ?? [];
  d.assignee = t.assignee ?? "";
  d.tags = (t.tags ?? []).join(", ");
  return d;
}

function EditExtras({
  task,
  preview,
  displayZone,
  pending,
  onError,
  onDone,
}: {
  task: import("@/domain/task").Task;
  preview: import("@/domain/priority").PriorityResult;
  displayZone: string;
  pending: boolean;
  onError: (m: string) => void;
  onDone: () => void;
}) {
  const { app, refresh, announce, debug, t: tr } = useApp();
  const [progressInput, setProgressInput] = useState(String(Math.round(task.progress * 100)));
  const [subtasks, setSubtasks] = useState<TaskView[]>([]);
  useEffect(() => {
    app.allViews().then((all) => setSubtasks(all.filter((v) => v.record.task.parentId === task.id)));
  }, [app, task.id]);
  const calendarLink = app.calendarLink(task);
  const [history, setHistory] = useState<
    { snapshots: import("@/domain/history").HistorySnapshot[]; omittedCount: number } | null
  >(null);

  function loadHistory() {
    if (!history) app.history(task.id).then(setHistory);
  }

  async function run(p: Promise<{ ok: boolean; error?: { message: string } }>, msg: string) {
    const res = await p;
    if (!res.ok) return onError(res.error?.message ?? "Action failed.");
    announce(msg);
    refresh();
    onDone();
  }

  return (
    <div className="dialog-section flex flex-col gap-3 text-sm">
      <p className="text-neutral-600">
        {labelText(preview)} · {remainingEffortText(preview)} ·{" "}
        {deadlineText(task.deadline, preview, displayZone)}
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        {calendarLink && (
          <a href={calendarLink} target="_blank" rel="noopener noreferrer" className="btn btn-sm no-underline">
            Add to Google Calendar
          </a>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            const name = window.prompt("Template name", task.title);
            if (!name?.trim()) return;
            await app.saveTemplate({ name: name.trim(), title: task.title, notes: task.notes, estimatedMinutes: task.estimatedMinutes, contextId: task.contextId, recurrence: task.recurrence ?? null, tags: task.tags ?? [] });
            announce("Template saved.");
          }}
        >
          {tr("saveTemplate")}
        </button>
      </div>
      {task.notes && (
        <details>
          <summary className="cursor-pointer text-xs text-neutral-500">Notes preview (Markdown)</summary>
          <Markdown text={task.notes} className="mt-1 text-sm" />
        </details>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">
          Subtasks {subtasks.length ? `· ${subtasks.filter((v) => v.record.task.status === "completed").length}/${subtasks.length} done` : ""}
        </span>
        {subtasks.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs">
            {subtasks.map((v) => (
              <li key={v.record.task.id} className={v.record.task.status === "completed" ? "line-through opacity-60" : ""}>
                {v.record.task.title}
              </li>
            ))}
          </ul>
        )}
        {task.status !== "completed" && task.status !== "archived" && (
          <button
            type="button"
            className="btn btn-sm w-fit"
            onClick={async () => {
              const title = window.prompt("Subtask title");
              if (!title?.trim()) return;
              const r = await app.createManualTask({ title: title.trim(), importance: "untouched", parentId: task.id, contextId: task.contextId });
              if (r.ok) {
                announce("Subtask added.");
                refresh();
                setSubtasks((await app.allViews()).filter((v) => v.record.task.parentId === task.id));
              } else onError(r.error.message);
            }}
          >
            + Subtask
          </button>
        )}
      </div>

      {task.status !== "completed" && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            Progress
            <input
              inputMode="numeric"
              value={progressInput}
              onChange={(e) => setProgressInput(e.target.value)}
              className="w-20"
              aria-label="Progress percent"
            />
            %
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            onClick={() => run(app.setProgress(task.id, task.revision, Number(progressInput)), "Progress updated.")}
          >
            Set progress
          </button>
          {Number(progressInput) >= 100 && (
            <span className="text-xs text-neutral-500">100% completes the task</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {task.userImportanceOverride ? (
          <button type="button" className="btn btn-sm" onClick={() => run(app.resetAxis(task.id, task.revision, "importance"), "Importance back to automatic.")}>
            Importance pinned — reset to automatic
          </button>
        ) : (
          <span className="text-xs text-neutral-500">Importance: automatic</span>
        )}
        {task.userUrgencyOverride ? (
          <button type="button" className="btn btn-sm" onClick={() => run(app.resetAxis(task.id, task.revision, "urgency"), "Urgency back to automatic.")}>
            Urgency pinned — reset to automatic
          </button>
        ) : (
          <span className="text-xs text-neutral-500">Urgency: automatic</span>
        )}
      </div>

      <details onToggle={loadHistory}>
        <summary className="cursor-pointer text-xs text-neutral-500">History</summary>
        {history == null ? (
          <p className="mt-1 text-xs text-neutral-400">Loading…</p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-neutral-600">
              {history.snapshots
                .slice()
                .reverse()
                .map((s) => (
                  <li key={s.sequence}>
                    {new Date(s.timestamp).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    — {s.reason.join(", ")} · u {s.urgency.toFixed(2)} / i {s.importance.toFixed(2)}
                    {s.urgencyPinned ? " (pinned)" : ""}
                    {debug ? ` · dp ${s.deadlinePressure.toFixed(2)} rev ${s.taskRevision}` : ""}
                  </li>
                ))}
            </ul>
            {history.omittedCount > 0 && (
              <p className="mt-1 text-[11px] text-neutral-400">
                Displayed history is bounded — {history.omittedCount} older snapshot
                {history.omittedCount > 1 ? "s" : ""} were pruned.
              </p>
            )}
          </>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs text-neutral-500">Danger zone</summary>
        <button
          type="button"
          className="btn btn-sm btn-danger mt-2"
          onClick={() => {
            if (
              window.confirm(
                `Permanently delete “${task.title}”? This removes the task and its history and cannot be undone.`,
              )
            ) {
              run(app.deletePermanently(task.id, task.revision), "Task permanently deleted.");
            }
          }}
        >
          Delete permanently…
        </button>
      </details>
    </div>
  );
}
