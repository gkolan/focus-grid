/**
 * Notification orchestration — contract section 47. Foreground in-app feed is the
 * baseline; OS notifications are an opt-in bonus that is never required and never
 * promised for a closed browser. No permission request on load.
 */
import type { Clock } from "@/domain/clock";
import { type NotificationEvent, orderEvents } from "@/domain/notifications";
import type { TaskRepository } from "@/persistence/repository";
import type { EventClaimRecord, SettingsRecord } from "@/persistence/schema";

/** More than this many events in one pass ⇒ a single summary instead of a flood. */
const RESUME_SUMMARY_THRESHOLD = 4;

export interface OsNotifier {
  permission(): NotificationPermission | "unsupported";
  request(): Promise<NotificationPermission | "unsupported">;
  show(body: string): boolean;
}

export class NotificationService {
  constructor(
    private readonly repo: TaskRepository,
    private readonly clock: Clock,
    private readonly getSettings: () => Promise<SettingsRecord | undefined>,
    private readonly os: OsNotifier,
  ) {}

  async processPass(events: NotificationEvent[], passInstant: Date): Promise<{
    delivered: number;
    suppressed: number;
    summary: boolean;
  }> {
    const settings = await this.getSettings();
    if (!settings?.notificationsEnabled || events.length === 0) {
      return { delivered: 0, suppressed: 0, summary: false };
    }
    const ctx = {
      quietHours: settings.quietHours,
      timeZone: settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      showTitles: settings.notificationTitles, // generic by default (UI-04)
    };
    const wantOs = settings.notificationsEnabled && this.os.permission() === "granted";

    const deliver = async (body: string) => {
      if (wantOs) this.os.show(body); // best effort; failure not retried
      return true; // in-app feed always records it
    };

    const ordered = orderEvents(events);

    if (ordered.length > RESUME_SUMMARY_THRESHOLD) {
      const stamp = passInstant.toISOString().slice(0, 13); // hour bucket
      const s = await this.repo.claimSummary(stamp, this.clock.now(), ctx, deliver);
      for (const e of ordered) await this.repo.claimSuppressed(e, this.clock.now());
      return { delivered: s === "delivered" ? 1 : 0, suppressed: ordered.length, summary: true };
    }

    let delivered = 0;
    let suppressed = 0;
    for (const e of ordered) {
      const r = await this.repo.claimNotification(e, this.clock.now(), ctx, deliver);
      if (r === "delivered") delivered++;
      else if (r === "suppressed") suppressed++;
    }
    return { delivered, suppressed, summary: false };
  }

  /** Recent in-app feed entries (delivered or the resume summary), newest first. */
  async feed(limit = 30): Promise<EventClaimRecord[]> {
    const since = this.clock.now().getTime() - 7 * 24 * 60 * 60_000;
    return (await this.repo.recentEventClaims(since))
      .filter((c) => c.delivered === "delivered")
      .slice(0, limit);
  }

  osPermission() {
    return this.os.permission();
  }
  requestOs() {
    return this.os.request();
  }
}

/** Browser Notification adapter. `unsupported` where the API is absent (47.2). */
export const browserOsNotifier: OsNotifier = {
  permission() {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  },
  async request() {
    if (typeof Notification === "undefined") return "unsupported";
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  },
  show(body) {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
      // route through the service worker when it controls the page so clicks focus the app.
      if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
        void navigator.serviceWorker.ready.then((reg) => reg.showNotification("FocusGrid", { body, tag: "focusgrid-live" })).catch(() => new Notification("FocusGrid", { body }));
        return true;
      }
      new Notification("FocusGrid", { body });
      return true;
    } catch {
      return false;
    }
  },
};
