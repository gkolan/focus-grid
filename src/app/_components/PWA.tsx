"use client";

import { useEffect, useState } from "react";

/**
 * Registers the service worker and shows a draft-safe "update ready" prompt
 * (contract 46.4). Never force-reloads. The SW caches only the static shell.
 */
export function PWA() {
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // dev: no SW

    let reg: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register("/sw.js")
      .then((r) => {
        reg = r;
        if (r.waiting && navigator.serviceWorker.controller) setUpdateReady(r.waiting);
        r.addEventListener("updatefound", () => {
          const sw = r.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(sw);
            }
          });
        });
      })
      .catch(() => {
        /* SW unavailable — the app still works online */
      });

    return () => void reg;
  }, []);

  if (!updateReady) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t px-4 py-2 text-sm shadow-lg" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
      <span>An update is ready. Save your draft before reloading.</span>
      <button
        className="btn btn-sm"
        onClick={() => {
          updateReady.postMessage("skip-waiting");
          updateReady.addEventListener("statechange", () => {
            if (updateReady.state === "activated") window.location.reload();
          });
          // fallback if statechange doesn't fire
          setTimeout(() => window.location.reload(), 800);
        }}
      >
        Reload to update
      </button>
      <button
        className="link"
        onClick={() => setUpdateReady(null)}
      >
        Not now
      </button>
    </div>
  );
}
