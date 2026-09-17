/*
 * FocusGrid service worker — contract 46.4.
 * Caches ONLY the app-owned static shell/assets. Never caches /api/ai/*, provider
 * responses, credentials, or the task database. IndexedDB owns tasks.
 * V2: handles Web Push payloads scheduled by /api/push (opt-in) and notification
 * clicks. No background sync or timed wake in the SW itself.
 */
const CACHE = "focusgrid-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("focusgrid-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never touch AI routes.
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    // Network-first for navigations; fall back to the cached shell offline.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || caches.match(event.request))),
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          if (res.ok && (url.pathname.startsWith("/_next/") || SHELL.includes(url.pathname))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});

// ── V2: push + notification click ───────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "FocusGrid", body: "A task needs your attention.", tag: "focusgrid" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* non-JSON payload — show the generic body */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, tag: data.tag, icon: "/icon.svg", badge: "/icon.svg" }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
