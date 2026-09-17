/**
 * Visible-app 15-minute heartbeat + resume catch-up — contract 42.1.
 * One effective schedule per tab. Hidden ⇒ suspended. Resume / focus / launch
 * are coalesced into ONE pass at the current instant (no missed-tick replay).
 * Zero AI calls. React mounts exactly one controller per tab.
 */
import type { Clock } from "@/domain/clock";
import { PRIORITY_CONFIG } from "@/domain/config";
import type { TaskRepository } from "@/persistence/repository";

const HEARTBEAT_MS = PRIORITY_CONFIG.heartbeatMinutes * 60_000;

export interface HeartbeatDeps {
  repo: TaskRepository;
  clock: Clock;
  onPass: (result: {
    recalculated: number;
    animatedIds: string[];
    events: import("@/domain/notifications").NotificationEvent[];
  }) => void;
}

export class HeartbeatController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private queued = false;
  private stopped = false;
  private readonly onVisibility = () => {
    if (document.visibilityState === "visible") {
      this.resume();
    } else {
      this.suspend();
    }
  };
  private readonly onFocus = () => this.resume();

  constructor(private readonly deps: HeartbeatDeps) {}

  /** Idempotent: calling start() again does not add a second schedule (RED-112). */
  start(): void {
    if (this.timer || this.stopped) {
      if (!this.stopped) void this.pass();
      return;
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("focus", this.onFocus);
    if (document.visibilityState === "visible") this.resume();
  }

  stop(): void {
    this.stopped = true;
    this.suspend();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("focus", this.onFocus);
  }

  private resume(): void {
    if (this.stopped) return;
    void this.pass(); // one catch-up pass at the current instant
    if (!this.timer) {
      this.timer = setInterval(() => void this.pass(), HEARTBEAT_MS);
    }
  }

  private suspend(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single-flight: overlapping triggers coalesce into at most one extra pass. */
  private async pass(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    try {
      const result = await this.deps.repo.recalcPass(this.deps.clock.now());
      this.deps.onPass(result);
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.pass();
      }
    }
  }
}
