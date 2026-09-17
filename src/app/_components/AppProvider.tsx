"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type AppState, getAppState, onExternalChange } from "@/application/repo";
import { HeartbeatController } from "@/application/heartbeat";
import { appClock } from "@/application/repo";
import type { FocusGridApp } from "@/application/service";
import type { NotificationService } from "@/application/notifications";
import type { Context } from "@/domain/task";
import type { AiCapability } from "@/ai/config";
import { type Key, type Lang, translate } from "./i18n";
import { syncReminders } from "@/application/push";
import { drainTelegram } from "@/application/telegram";

interface UndoOffer {
  label: string;
  run: () => Promise<{ ok: boolean; error?: { message: string } }>;
}

interface Ctx {
  app: FocusGridApp;
  notifications: NotificationService;
  demo: boolean;
  aiCapability: AiCapability;
  contexts: Context[];
  version: number;
  animatedIds: Set<string>;
  debug: boolean;
  setDebug: (v: boolean) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
  refresh: () => void;
  announce: (msg: string) => void;
  offerUndo: (offer: UndoOffer) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside <AppProvider>");
  return c;
}

export function AppProvider({
  children,
  aiCapability,
}: {
  children: React.ReactNode;
  aiCapability: AiCapability;
}) {
  const [state, setState] = useState<AppState | null>(null);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [version, setVersion] = useState(0);
  const [animatedIds, setAnimatedIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<{ text: string; id: number }>({ text: "", id: 0 });
  const [undo, setUndo] = useState<(UndoOffer & { id: number }) | null>(null);
  const [debug, setDebugState] = useState(() => {
    try {
      return localStorage.getItem("focusgrid.debug") === "1";
    } catch {
      return false;
    }
  });

  const [lang, setLangState] = useState<Lang>("en");
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const t = useCallback((k: Key) => translate(lang, k), [lang]);
  const announce = useCallback((text: string) => setMessage({ text, id: Date.now() }), []);
  const offerUndo = useCallback((offer: UndoOffer) => setUndo({ ...offer, id: Date.now() }), []);
  const setDebug = useCallback((v: boolean) => {
    setDebugState(v);
    try {
      localStorage.setItem("focusgrid.debug", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    getAppState().then((s) => {
      setState(s);
      if (
        s.ok &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("e2e")
      ) {
        (window as unknown as { __focusgrid?: unknown }).__focusgrid = {
          app: s.app,
          repo: s.repo,
          notifications: s.notifications,
          clock: appClock,
          refresh,
        };
      }
    });
    return onExternalChange(refresh);
  }, [refresh]);

  // Exactly one heartbeat controller per tab (RED-112).
  useEffect(() => {
    if (!state?.ok) return;
    const s = state;
    const hb = new HeartbeatController({
      repo: s.repo,
      clock: { now: () => appClock.current.now() },
      onPass: ({ recalculated, animatedIds: ids, events }) => {
        if (recalculated > 0) {
          setAnimatedIds(new Set(ids));
          setVersion((v) => v + 1);
        }
        if (events.length > 0) {
          s.notifications
            .processPass(events, appClock.current.now())
            .then((r) => {
              if (r.delivered > 0 || r.summary) setVersion((v) => v + 1);
            });
        }
      },
    });
    hb.start();
    return () => hb.stop();
  }, [state]);

  useEffect(() => {
    if (state?.ok) state.app.contexts().then(setContexts);
  }, [state, version]);

  // language + push reminder schedule follow settings; push re-syncs after any change (throttled).
  const lastSync = useMemo(() => ({ at: 0 }), []);
  useEffect(() => {
    if (!state?.ok) return;
    const s = state;
    s.app.getSettings().then(async (cfg) => {
      setLangState(cfg?.language ?? "en");
      if (!cfg?.pushEnabled || Date.now() - lastSync.at < 60_000) return;
      lastSync.at = Date.now();
      const tasks = (await s.app.allViews()).map((v) => v.record.task);
      void syncReminders(tasks, appClock.current.now(), cfg.notificationTitles);
    });
  }, [state, version, lastSync]);
  // pull tasks captured via the Telegram bot; stops after the first 503 (not configured).
  useEffect(() => {
    if (!state?.ok) return;
    const s = state;
    const tick = async () => {
      const made = await drainTelegram(s.app);
      if (made === null) return clearInterval(timer);
      if (made.length) {
        refresh();
        announce(`Added from Telegram: ${made.join(", ")}`);
      }
    };
    const timer = setInterval(() => void tick(), 15_000);
    void tick();
    return () => clearInterval(timer);
  }, [state, refresh, announce]);
  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      if (state?.ok) void state.app.updateSettings({ language: l });
    },
    [state],
  );

  useEffect(() => {
    if (!message.text) return;
    const t = setTimeout(() => setMessage((m) => (m.id === message.id ? { text: "", id: m.id } : m)), 6000);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo((u) => (u?.id === undo.id ? null : u)), 10_000);
    return () => clearTimeout(t);
  }, [undo]);

  const value = useMemo<Ctx | null>(
    () =>
      state?.ok
        ? { app: state.app, notifications: state.notifications, demo: state.demo, aiCapability, contexts, version, animatedIds, debug, setDebug, lang, setLang, t, refresh, announce, offerUndo }
        : null,
    [state, aiCapability, contexts, version, animatedIds, debug, setDebug, lang, setLang, t, refresh, announce, offerUndo],
  );

  return (
    <>
      <div aria-live="polite" role="status" className="sr-only" data-testid="live-region">
        {message.text}
      </div>
      {state == null ? (
        <Centered>Loading FocusGrid…</Centered>
      ) : !state.ok ? (
        <Centered>
          <p className="font-medium">FocusGrid can’t open local storage</p>
          <p className="mt-1 max-w-sm text-sm text-neutral-600">{state.message}</p>
        </Centered>
      ) : value ? (
        <AppCtx.Provider value={value}>
          {children}
          {undo && (
            <div className="toast" role="status">
              <span>{undo.label}</span>
              <button
                className="btn btn-sm"
                style={{ borderRadius: 999 }}
                onClick={async () => {
                  const r = await undo.run();
                  announce(r.ok ? "Undone." : (r.error?.message ?? "Could not undo."));
                  setUndo(null);
                  refresh();
                }}
              >
                Undo
              </button>
            </div>
          )}
        </AppCtx.Provider>
      ) : null}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      {children}
    </div>
  );
}
