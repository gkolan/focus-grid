"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { isValidTimeZone, type Context } from "@/domain/task";
import { detectZone } from "./format";
import { NotificationSettings } from "./Notifications";
import { ActivitySection, CalendarSection, ExternalImportSection, LanguageSection, PublicCalendarsSection, PushSection, TemplatesSection, TuningSection, WebhookSection } from "./SettingsSections";

const COMMON_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const GROUPS = [
  ["general", "General"],
  ["notifications", "Notifications"],
  ["data", "Data"],
  ["integrations", "Integrations"],
  ["advanced", "Advanced"],
] as const;

export function SettingsView({
  displayZone,
  aiStatus,
  demo = false,
}: {
  displayZone: string;
  aiStatus: string;
  demo?: boolean;
}) {
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>("general");
  const { app, contexts, refresh, announce, debug, setDebug } = useApp();
  const [zone, setZone] = useState(displayZone);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    app.getSettings().then((s) => {
      if (s) setPinned(s.sidebarPinned);
    });
  }, [app]);

  async function togglePin(next: boolean) {
    setPinned(next);
    await app.updateSettings({ sidebarPinned: next });
    announce(next ? "Side panel pinned." : "Side panel hidden.");
    refresh();
  }

  async function saveZone(next: string) {
    if (!isValidTimeZone(next)) {
      setZoneError("Unknown time zone.");
      return;
    }
    setZoneError(null);
    setZone(next);
    await app.updateSettings({ timeZone: next });
    announce("Display time zone saved.");
    refresh();
  }

  async function exportBackup() {
    const { filename, json } = await app.exportBackup();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    announce("Backup downloaded.");
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="view-bar"><h1>Settings</h1></div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <nav className="settings-nav flex shrink-0 overflow-auto border-b lg:w-[400px] lg:flex-col lg:border-b-0 lg:border-r xl:w-[440px]" style={{ borderColor: "var(--line)" }} aria-label="Settings sections">
        {GROUPS.map(([id, label]) => (
          <button key={id} aria-current={group === id ? "page" : undefined} className={`settings-nav-item border-b px-5 py-3 text-left text-sm font-medium ${group === id ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--field)]"}`} style={{ borderColor: "var(--line)" }} onClick={() => { setGroup(id); document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start" }); }}>{label}</button>
        ))}
      </nav>
      <div className="grid-canvas flex min-w-0 flex-1 flex-col overflow-auto">
      <div id="settings-general" className="settings-group"><h2 className="settings-group-title">General</h2>
      <ContextManager contexts={contexts} />

      <section className="flex flex-col gap-2">
        <h2>Display time zone</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            aria-label="Display time zone"
            value={COMMON_ZONES.includes(zone) ? zone : "custom"}
            onChange={(e) => e.target.value !== "custom" && saveZone(e.target.value)}
          >
            {COMMON_ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
            {!COMMON_ZONES.includes(zone) && <option value="custom">{zone}</option>}
          </select>
          <button type="button" className="btn" onClick={() => saveZone(detectZone())}>
            Use device zone
          </button>
        </div>
        {zoneError && <p className="text-danger text-xs">{zoneError}</p>}
        <p className="text-xs text-neutral-500">
          Changing this reformats times only. It never rewrites a deadline’s stored zone.
        </p>
      </section>

      <LanguageSection />

      <section className="flex flex-col gap-2">
        <h2>Grid side panel</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => togglePin(e.target.checked)} />
          Pin the task list beside the field (desktop only, ≥ 1024px)
        </label>
        <p className="text-xs text-neutral-500">Hidden by default so the field gets the full width.</p>
      </section>

      </div>
      <div id="settings-notifications" className="settings-group"><h2 className="settings-group-title">Notifications</h2>
      <NotificationSettings />
      <PushSection displayZone={displayZone} />
      </div>
      <div id="settings-data" className="settings-group"><h2 className="settings-group-title">Data</h2>

      <section className="flex flex-col gap-3">
        <h2>Backup</h2>
        <p className="text-sm text-neutral-600">
          FocusGrid keeps your tasks in this browser profile only — no account, no sync. Browser
          storage is not a backup.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportBackup} className="btn">
            Export backup (.json)
          </button>
          <ImportControl />
        </div>
        <p className="text-xs text-neutral-500">
          Private browsing and browser “clear site data” can erase this store without warning —
          export regularly. Deleting a task here does not delete copies already sent to an AI
          provider.
        </p>
      </section>

      <ExternalImportSection displayZone={displayZone} />
      <TemplatesSection />
      </div>
      <div id="settings-integrations" className="settings-group"><h2 className="settings-group-title">Integrations</h2>
      <CalendarSection />
      <PublicCalendarsSection />
      <WebhookSection />
      </div>
      <div id="settings-advanced" className="settings-group"><h2 className="settings-group-title">Advanced</h2>

      <section className="flex flex-col gap-2">
        <h2>AI capture</h2>
        <p className="text-sm text-neutral-600" data-testid="ai-status">
          {aiStatus}
        </p>
        <button
          className="btn w-fit"
          onClick={async () => {
            const r = await app.clearInterpretationHistory();
            announce(`Cleared ${r.removed} AI interpretation record(s). Your tasks are unchanged.`);
            refresh();
          }}
        >
          Clear AI interpretation history
        </button>
        <p className="text-xs text-neutral-500">
          Removes stored rationale and confidence. Task values and manual overrides are not changed.
        </p>
      </section>

      <TuningSection />
      <ActivitySection />

      <section className="flex flex-col gap-2">
        <h2>Debug</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
          Show numeric priority factors, revision, and engine version
        </label>
        <p className="text-xs text-neutral-500">Off by default. Nothing is logged or sent anywhere.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-danger">Danger zone</h2>
        <div className="flex flex-wrap gap-2">
          <DeleteAllControl />
          {demo && (
            <button
              onClick={async () => {
                const { resetDemo } = await import("@/application/repo");
                await resetDemo();
                announce("Demo reset.");
                refresh();
              }}
              className="btn"
            >
              Reset demo
            </button>
          )}
        </div>
      </section>
      </div>
      </div>
      </div>
    </div>
  );
}

function ImportControl() {
  const { app, refresh, announce } = useApp();
  const [preview, setPreview] = useState<
    | { ok: true; value: import("@/persistence/import").ParsedImport; text: string }
    | { ok: false; message: string }
    | null
  >(null);

  async function pick(file: File) {
    const text = await file.text();
    const res = app.previewImport(text);
    setPreview(res.ok ? { ok: true, value: res.value, text } : { ok: false, message: res.error.message });
  }

  async function confirm() {
    if (!preview?.ok) return;
    const res = await app.importCopies(preview.text);
    if (!res.ok) {
      setPreview({ ok: false, message: res.error.message });
      return;
    }
    announce(`Imported ${res.value.tasksAdded} task(s) and ${res.value.contextsAdded} new context(s) as copies.`);
    setPreview(null);
    refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="btn cursor-pointer">
        Import copies from a backup…
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            e.target.value = "";
          }}
        />
      </label>
      {preview && !preview.ok && <p className="text-danger text-xs">{preview.message}</p>}
      {preview?.ok && (
        <div className="notice notice-info text-xs">
          <p>
            This will add <strong>{preview.value.taskCount}</strong> task(s) and up to{" "}
            <strong>{preview.value.contextCount}</strong> context(s) as new copies. Your current
            tasks and settings are not changed.
          </p>
          {preview.value.warnings.map((w, i) => (
            <p key={i} className="mt-0.5 text-neutral-500">
              {w}
            </p>
          ))}
          <div className="mt-2 flex gap-2">
            <button onClick={confirm} className="btn btn-sm btn-primary">
              Import
            </button>
            <button onClick={() => setPreview(null)} className="btn btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeleteAllControl() {
  const { app, refresh, announce } = useApp();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  return (
    <div className="flex w-full flex-col gap-2">
      <button onClick={() => setOpen((o) => !o)} className="btn btn-danger w-fit">
        Delete all local data…
      </button>
      {open && (
        <div className="notice notice-danger flex flex-col gap-2 text-xs">
          <p>
            This permanently removes every task, context, history record, AI metadata, settings and
            unsaved drafts in this browser. Exported backup files on your computer are not touched.
            Type <strong>DELETE ALL</strong> to confirm.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type DELETE ALL to confirm"
            className="w-48"
          />
          <div className="flex gap-2">
            <button
              disabled={typed !== "DELETE ALL"}
              onClick={async () => {
                await app.deleteAllLocalData();
                announce("All local data deleted.");
                setOpen(false);
                setTyped("");
                refresh();
              }}
              className="btn btn-sm btn-danger-solid"
            >
              Delete everything
            </button>
            <button onClick={() => setOpen(false)} className="btn btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContextRow({ context: c, onDelete }: { context: Context; onDelete: () => void }) {
  const { app, refresh, announce } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const res = await app.updateContext(c.id, { name, color });
    if (!res.ok) return setError(res.error.message);
    setError(null);
    setEditing(false);
    announce("Context updated.");
    refresh();
  }

  if (editing && !c.seeded) {
    return (
      <li className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Rename ${c.name}`}
          className="w-44"
        />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={`Colour for ${c.name}`} />
        <button onClick={save} className="btn btn-sm btn-primary">Save</button>
        <button onClick={() => setEditing(false)} className="btn btn-sm">Cancel</button>
        {error && <span className="text-danger text-xs">{error}</span>}
      </li>
    );
  }

  return (
    <li className="flex min-h-9 items-center gap-2.5">
      <span className="inline-block h-3 w-3 rounded-full" style={{ background: c.color }} />
      <span className="flex-1">{c.name}</span>
      {c.seeded ? (
        <span className="text-xs text-neutral-500">built-in</span>
      ) : (
        <>
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="btn btn-sm" onClick={onDelete}>
            Delete
          </button>
        </>
      )}
    </li>
  );
}

function ContextManager({ contexts }: { contexts: Context[] }) {
  const { app, refresh, announce } = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Context | null>(null);
  const [reassign, setReassign] = useState<string>("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const res = await app.createContext(name, color);
    if (!res.ok) return setError(res.error.message);
    setError(null);
    setName("");
    announce("Context created.");
    refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await app.deleteContext(deleting.id, reassign || null);
    if (!res.ok) return setError(res.error.message);
    announce(`Context deleted. ${res.value.moved} task(s) moved.`);
    setDeleting(null);
    setReassign("");
    refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      <h2>Contexts</h2>
      <p className="text-xs text-neutral-500">Colour-coded areas of your life — each task belongs to one, and the grid can be filtered by them.</p>
      {error && <p className="text-danger text-xs">{error}</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {contexts.map((c) => (
          <ContextRow key={c.id} context={c} onDelete={() => setDeleting(c)} />
        ))}
      </ul>

      <form onSubmit={add} className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="New context"
          aria-label="New context"
          className="w-44"
        />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Context colour" />
        <button className="btn">Add</button>
      </form>

      {deleting && (
        <div className="notice notice-warn flex flex-col gap-2 text-sm">
          <p>
            Delete “{deleting.name}”. Its tasks are not deleted — choose where they go:
          </p>
          <select
            aria-label="Move tasks to"
            value={reassign}
            onChange={(e) => setReassign(e.target.value)}
            className="w-fit"
          >
            <option value="">Uncategorized</option>
            {contexts
              .filter((c) => c.id !== deleting.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <div className="flex gap-2">
            <button onClick={confirmDelete} className="btn btn-sm btn-danger-solid">
              Delete and move tasks
            </button>
            <button onClick={() => setDeleting(null)} className="btn btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
