"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { LANGS, type Lang } from "./i18n";
import { isWebhookUrl } from "@/application/webhooks";
import { currentSubscription, pushCapability, subscribePush, syncReminders, unsubscribePush } from "@/application/push";
import type { ImportRow, ImportSource } from "@/persistence/importers";
import type { TaskTemplate } from "@/persistence/schema";
import type { PriorityTuning } from "@/domain/config";
import { type CalendarFeed, HOLIDAY_PRESETS } from "@/domain/feeds";
import { forgetFeedCache, loadFeedEvents } from "@/application/feeds";

const btn = "btn";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LanguageSection() {
  const { lang, setLang, t } = useApp();
  return (
    <section className="flex flex-col gap-2">
      <h2>{t("language")}</h2>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="w-fit" aria-label={t("language")}>
        {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      <p className="text-xs text-neutral-500">Translates the interface chrome. Your task text is never translated.</p>
    </section>
  );
}

export function TuningSection() {
  const { app, refresh, announce } = useApp();
  const [t, setT] = useState<PriorityTuning>(() => app.tuning());
  const [dirty, setDirty] = useState(false);
  const set = (k: keyof PriorityTuning, v: number) => {
    setT((c) => ({ ...c, [k]: v }));
    setDirty(true);
  };
  const sum = (t.deadlineWeight ?? 0) + (t.effortWeight ?? 0) + (t.overdueWeight ?? 0) || 1;
  return (
    <section className="flex flex-col gap-2">
      <h2>Priority curve</h2>
      <p className="text-xs text-neutral-500">How urgency is built from deadline pressure, remaining effort and overdue time. Weights are scaled to add up to 1. Same inputs, same result either way.</p>
      {(
        [
          ["deadlineWeight", "Deadline pressure"],
          ["effortWeight", "Remaining effort"],
          ["overdueWeight", "Overdue"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-sm">
          <span className="w-40">{label}</span>
          <input type="range" min={0} max={1} step={0.05} value={t[k] ?? 0} onChange={(e) => set(k, Number(e.target.value))} aria-label={label} className="flex-1 max-w-56" />
          <span className="w-12 text-xs text-neutral-500">{Math.round(((t[k] ?? 0) / sum) * 100)}%</span>
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <span className="w-40">Overdue saturates after</span>
        <input inputMode="numeric" value={Math.round((t.overdueSaturationMinutes ?? 1440) / 60)} onChange={(e) => set("overdueSaturationMinutes", Math.max(1, Number(e.target.value) || 24) * 60)} className="w-20" aria-label="Overdue saturation hours" />
        <span className="text-xs text-neutral-500">hours</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-40">Needs review after</span>
        <input inputMode="numeric" value={Math.round((t.staleAfterMinutes ?? 10080) / 1440)} onChange={(e) => set("staleAfterMinutes", Math.max(1, Number(e.target.value) || 7) * 1440)} className="w-20" aria-label="Needs review after days" />
        <span className="text-xs text-neutral-500">days overdue</span>
      </label>
      <div className="mt-1 flex gap-2">
        <button
          className="btn btn-primary"
          disabled={!dirty}
          onClick={async () => {
            await app.setTuning(t);
            setDirty(false);
            announce("Priority curve saved and every task recalculated.");
            refresh();
          }}
        >
          Apply
        </button>
        <button
          className={btn}
          onClick={async () => {
            await app.setTuning(null);
            setT(app.tuning());
            setDirty(false);
            announce("Priority curve reset to the defaults.");
            refresh();
          }}
        >
          Reset to defaults
        </button>
      </div>
    </section>
  );
}

export function WebhookSection() {
  const { app, announce } = useApp();
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    app.getSettings().then((s) => setUrl(s?.webhookUrl ?? ""));
  }, [app]);
  return (
    <section className="flex flex-col gap-2">
      <h2>Webhook</h2>
      <p className="text-xs text-neutral-500">POST a JSON event (created, completed, blocked, deadline changed…) to a Zapier / Make / n8n catch URL. Sent from this browser, fire-and-forget.</p>
      <div className="flex flex-wrap gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/…" className="min-w-56 flex-1" aria-label="Webhook URL" />
        <button
          className={btn}
          onClick={async () => {
            const v = url.trim();
            if (v && !isWebhookUrl(v)) return setErr("Enter an https:// URL.");
            setErr(null);
            await app.updateSettings({ webhookUrl: v || null });
            announce(v ? "Webhook saved." : "Webhook removed.");
          }}
        >
          Save
        </button>
      </div>
      {err && <p className="text-danger text-xs">{err}</p>}
    </section>
  );
}

export function PushSection({ displayZone }: { displayZone: string }) {
  const { app, announce } = useApp();
  const [cap, setCap] = useState<{ enabled: boolean; publicKey: string | null } | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    pushCapability().then(setCap);
    currentSubscription().then((s) => setOn(!!s));
  }, []);
  void displayZone;
  if (!cap) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2>Push reminders (tab closed)</h2>
      {!cap.enabled ? (
        <p className="text-xs text-neutral-500">
          Not configured on this server. Set <code>FOCUSGRID_VAPID_PUBLIC_KEY</code> / <code>FOCUSGRID_VAPID_PRIVATE_KEY</code> (generate with <code>npx web-push generate-vapid-keys</code>) and restart.
        </p>
      ) : (
        <>
          <p className="text-xs text-neutral-500">
            Deadline reminders (a day before, an hour before for timed deadlines, and at the deadline) are computed here and scheduled on the server, so they arrive even when FocusGrid is closed. Only reminder text and times leave this browser; task titles only if titles are enabled under Notifications.
          </p>
          <button
            className={btn}
            onClick={async () => {
              if (on) {
                await unsubscribePush();
                await app.updateSettings({ pushEnabled: false });
                setOn(false);
                announce("Push reminders off.");
                return;
              }
              if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
                const p = await Notification.requestPermission();
                if (p !== "granted") return announce("Notification permission was not granted.");
              }
              const sub = await subscribePush(cap.publicKey!);
              if (!sub) return announce("Push is not available in this browser (needs the installed app or a service worker).");
              await app.updateSettings({ pushEnabled: true });
              const s = await app.getSettings();
              const tasks = (await app.allViews()).map((v) => v.record.task);
              const ok = await syncReminders(tasks, new Date(), s?.notificationTitles ?? false);
              setOn(true);
              announce(ok ? "Push reminders on and scheduled." : "Subscribed, but scheduling failed — will retry on the next heartbeat.");
            }}
          >
            {on ? "Turn off push reminders" : "Turn on push reminders"}
          </button>
        </>
      )}
    </section>
  );
}

export function CalendarSection() {
  const { app, announce } = useApp();
  return (
    <section className="flex flex-col gap-2">
      <h2>Calendar & sharing</h2>
      <div className="flex flex-wrap gap-2">
        <button
          className={btn}
          onClick={async () => {
            const { filename, ics } = await app.exportIcs();
            download(filename, ics, "text/calendar");
            announce("Calendar file downloaded — import it into Google Calendar, Outlook or Apple Calendar.");
          }}
        >
          Export deadlines (.ics)
        </button>
        <button
          className={btn}
          onClick={async () => {
            const { filename, html } = await app.exportSnapshotHtml();
            download(filename, html, "text/html");
            announce("Read-only snapshot downloaded.");
          }}
        >
          Export read-only snapshot (.html)
        </button>
      </div>
      <p className="text-xs text-neutral-500">Each task also has an “Add to Google Calendar” link in its editor. The snapshot is a plain page with no script — safe to email.</p>
    </section>
  );
}

export function PublicCalendarsSection() {
  const { app, refresh, announce } = useApp();
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    app.calendarFeeds().then(setFeeds);
  }, [app]);

  const add = async (n: string, u: string) => {
    setBusy(true);
    setError(null);
    const r = await app.addCalendarFeed(n, u);
    if (!r.ok) {
      setError(r.error.message);
    } else {
      const { events, error } = await loadFeedEvents(r.value, true);
      if (error) {
        await app.removeCalendarFeed(r.value.id);
        setError(error);
      } else {
        setFeeds(await app.calendarFeeds());
        setName("");
        setUrl("");
        announce(`Subscribed to ${r.value.name} — ${events.length} event(s).`);
        refresh();
      }
    }
    setBusy(false);
  };

  return (
    <section className="flex flex-col gap-2">
      <h2>Public calendars</h2>
      <p className="text-xs text-neutral-500">Overlay holidays, fixtures or local events on the Calendar view. Paste any iCal link (<code>webcal://</code> or <code>https://…ics</code>) — most sports and events sites offer one under “Subscribe” or “Add to calendar”. Read-only: they never become tasks.</p>
      <form
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void add(name, url);
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Arsenal fixtures)" className="w-52" aria-label="Calendar name" maxLength={60} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal:// or https://…ics" className="min-w-56 flex-1" aria-label="Calendar URL" required />
        <button type="submit" className={btn} disabled={busy}>{busy ? "Checking…" : "Subscribe"}</button>
        <select
          aria-label="Add public holidays"
          value=""
          disabled={busy}
          onChange={(e) => {
            const p = HOLIDAY_PRESETS.find((x) => x.url === e.target.value);
            if (p) void add(p.label, p.url);
          }}
        >
          <option value="">Add holidays…</option>
          {HOLIDAY_PRESETS.map((p) => <option key={p.url} value={p.url}>{p.label}</option>)}
        </select>
      </form>
      {error && <p className="text-danger text-xs">{error}</p>}
      {feeds.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {feeds.map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: f.color }} />
              <span className="truncate" title={f.url}>{f.name}</span>
              <button
                className="link ml-auto"
                style={{ color: "var(--muted)" }}
                onClick={async () => {
                  await loadFeedEvents(f, true);
                  refresh();
                  announce(`${f.name} refreshed.`);
                }}
              >
                Refresh
              </button>
              <button
                className="link text-danger"
                onClick={async () => {
                  await app.removeCalendarFeed(f.id);
                  forgetFeedCache(f.url);
                  setFeeds(await app.calendarFeeds());
                  refresh();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ExternalImportSection({ displayZone }: { displayZone: string }) {
  const { app, refresh, announce } = useApp();
  const [source, setSource] = useState<ImportSource>("csv");
  const [preview, setPreview] = useState<{ rows: ImportRow[] } | { message: string } | null>(null);
  return (
    <section className="flex flex-col gap-2">
      <h2>Import from other apps</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={source} onChange={(e) => setSource(e.target.value as ImportSource)} aria-label="Import source">
          <option value="csv">CSV (title, notes, due, estimate, context, tags, importance)</option>
          <option value="todoist">Todoist CSV export</option>
          <option value="google-tasks">Google Tasks (Takeout Tasks.json)</option>
        </select>
        <label className={`${btn} cursor-pointer`}>
          Choose file…
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const r = app.previewExternalImport(source, await f.text(), displayZone);
              setPreview(r.ok ? { rows: r.value } : { message: r.error.message });
            }}
          />
        </label>
      </div>
      {preview && "message" in preview && <p className="text-danger text-xs">{preview.message}</p>}
      {preview && "rows" in preview && (
        <div className="notice notice-info text-xs">
          <p>
            <strong>{preview.rows.length}</strong> task(s) found · {preview.rows.filter((r) => r.deadline).length} with a deadline ·{" "}
            {new Set(preview.rows.map((r) => r.contextName).filter(Boolean)).size} context(s) · {preview.rows.filter((r) => r.parentTitle).length} subtask(s)
          </p>
          <ul className="mt-1 max-h-32 overflow-auto">
            {preview.rows.slice(0, 20).map((r, i) => <li key={i}>{r.parentTitle ? "↳ " : ""}{r.title}{r.deadline ? ` — ${r.deadline.kind === "date" ? r.deadline.date : r.deadline.at.slice(0, 16)}` : ""}</li>)}
            {preview.rows.length > 20 && <li>…</li>}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => {
                const r = await app.importExternal(preview.rows);
                if (r.ok) announce(`Imported ${r.value.tasksAdded} task(s) and ${r.value.contextsAdded} new context(s).`);
                setPreview(null);
                refresh();
              }}
              className="btn btn-sm btn-primary"
            >
              Import
            </button>
            <button onClick={() => setPreview(null)} className="btn btn-sm">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function TemplatesSection() {
  const { app, announce, version } = useApp();
  const [list, setList] = useState<TaskTemplate[]>([]);
  useEffect(() => {
    app.templates().then(setList);
  }, [app, version]);
  return (
    <section className="flex flex-col gap-2">
      <h2>Task templates</h2>
      {list.length === 0 ? (
        <p className="text-xs text-neutral-500">None yet. Open a task and choose “Save as template”.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {list.map((tp) => (
            <li key={tp.id} className="flex items-center gap-2">
              <span className="flex-1">{tp.name} <span className="text-xs text-neutral-500">— {tp.title}{tp.recurrence ? ` · every ${tp.recurrence.every} ${tp.recurrence.unit}(s)` : ""}</span></span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await app.deleteTemplate(tp.id);
                  setList(await app.templates());
                  announce("Template deleted.");
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ActivitySection() {
  const { app, version } = useApp();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof app.timeline>> | null>(null);
  return (
    <section className="flex flex-col gap-2">
      <h2>Activity</h2>
      <details onToggle={(e) => e.currentTarget.open && app.timeline().then(setRows)}>
        <summary className="text-sm text-neutral-600">Recent changes across all tasks</summary>
        {rows == null ? (
          <p className="mt-1 text-xs text-neutral-400">Loading…</p>
        ) : (
          <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-auto text-xs text-neutral-600" key={version}>
            {rows.map((s) => (
              <li key={`${s.taskId}-${s.sequence}`}>
                {new Date(s.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — <strong>{s.title}</strong>: {s.reason.join(", ")} · u {s.urgency.toFixed(2)} / i {s.importance.toFixed(2)}
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}


