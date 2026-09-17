"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import type { EventClaimRecord } from "@/persistence/schema";

export function NotificationBell() {
  const { notifications, version } = useApp();
  const [feed, setFeed] = useState<EventClaimRecord[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    notifications.feed().then(setFeed);
  }, [notifications, version]);

  // close on outside click / Escape, like any other popover
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrap}>
      <button
        aria-label={`Notifications (${feed.length})`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="header-icon relative"
      >
        <span aria-hidden>🔔</span>
        {feed.length > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4" style={{ background: "var(--accent)", color: "var(--surface)" }}>{feed.length}</span>}
      </button>
      {open && (
        <div className="popover right-0 mt-2 w-80 p-3 text-sm">
          <p className="mb-2 text-xs text-neutral-500">
            In-app feed — delivery is best effort and never guaranteed for a closed browser.
          </p>
          {feed.length === 0 ? (
            <p className="py-4 text-center text-neutral-500">Nothing yet.</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
              {feed.map((c) => (
                <li key={c.key} className="border-b py-1.5 last:border-0" style={{ borderColor: "var(--line)" }}>
                  <p>{c.body}</p>
                  <p className="text-[11px] text-neutral-400">
                    {new Date(c.claimedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function NotificationSettings() {
  const { app, notifications, refresh, announce } = useApp();
  const [s, setS] = useState<{
    notificationsEnabled: boolean;
    notificationTitles: boolean;
    quietHours: { start: string; end: string } | null;
  } | null>(null);
  const [osState, setOsState] = useState<string>(() => notifications.osPermission());

  useEffect(() => {
    app.getSettings().then((v) =>
      setS({
        notificationsEnabled: v?.notificationsEnabled ?? false,
        notificationTitles: v?.notificationTitles ?? false,
        quietHours: v?.quietHours ?? { start: "21:00", end: "08:00" },
      }),
    );
  }, [app]);

  async function patch(p: Partial<NonNullable<typeof s>>) {
    const next = { ...s!, ...p };
    setS(next);
    await app.updateSettings(next);
    refresh();
  }

  if (!s) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2>Notifications</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.notificationsEnabled}
          onChange={(e) => patch({ notificationsEnabled: e.target.checked })}
        />
        Show in-app notifications when a task becomes time-sensitive
      </label>
      <p className="text-xs text-neutral-500">
        No streaks, no guilt. FocusGrid never asks for system permission on its own.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {osState === "unsupported" ? (
          <span className="text-xs text-neutral-500">
            System notifications aren’t available here. You can use in-app notifications.
          </span>
        ) : osState === "granted" ? (
          <span className="text-xs text-neutral-500">System notifications are enabled.</span>
        ) : osState === "denied" ? (
          <span className="text-xs text-neutral-500">
            System notifications are blocked in your browser settings. In-app notifications still work.
          </span>
        ) : (
          <button
            className="btn"
            onClick={async () => {
              const r = await notifications.requestOs();
              setOsState(r);
              announce(r === "granted" ? "System notifications enabled." : "Using in-app notifications.");
            }}
          >
            Enable system notifications
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.notificationTitles}
          onChange={(e) => patch({ notificationTitles: e.target.checked })}
        />
        Include the task title (default is generic text; notes are never shown)
      </label>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Quiet hours</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.quietHours != null}
            onChange={(e) => patch({ quietHours: e.target.checked ? { start: "21:00", end: "08:00" } : null })}
          />
          enabled
        </label>
        {s.quietHours && (
          <>
            <input
              type="time"
              value={s.quietHours.start}
              onChange={(e) => patch({ quietHours: { ...s.quietHours!, start: e.target.value } })}
              aria-label="Quiet hours start"
            />
            <span>to</span>
            <input
              type="time"
              value={s.quietHours.end}
              onChange={(e) => patch({ quietHours: { ...s.quietHours!, end: e.target.value } })}
              aria-label="Quiet hours end"
            />
          </>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        Events during quiet hours are recorded and skipped — they are never replayed as a burst later.
      </p>
    </section>
  );
}
