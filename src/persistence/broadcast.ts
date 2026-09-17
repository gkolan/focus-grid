/**
 * Cross-tab invalidation after commit — contract 42.1. Lightweight message only
 * ("something changed"); receivers reload committed data and re-check revisions.
 * Falls back to a no-op emitter when BroadcastChannel is unavailable; callers
 * then reload on focus and rely on revision checks.
 */
export interface Invalidation {
  taskId: string;
  revision: number;
  source: string;
}

export interface TabBus {
  post(msg: Invalidation): void;
  subscribe(fn: (msg: Invalidation) => void): () => void;
  close(): void;
}

export function createTabBus(name = "focusgrid-invalidate"): TabBus {
  if (typeof BroadcastChannel === "undefined") {
    return { post() {}, subscribe: () => () => {}, close() {} };
  }
  const ch = new BroadcastChannel(name);
  return {
    post: (msg) => ch.postMessage(msg),
    subscribe(fn) {
      const handler = (e: MessageEvent<Invalidation>) => fn(e.data);
      ch.addEventListener("message", handler);
      return () => ch.removeEventListener("message", handler);
    },
    close: () => ch.close(),
  };
}
