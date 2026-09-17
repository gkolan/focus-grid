import type { Clock } from "@/domain/clock";

/** Deterministic clock for tests. Advance it explicitly; it never ticks on its own. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(initial: string | Date) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: string | Date): void {
    this.current = new Date(instant);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

/** Canonical fixture instant/zone referenced by the AI capture goldens (43.6). */
export const FIXTURE_NOW = "2026-09-09T14:00:00.000Z";
export const FIXTURE_TIME_ZONE = "America/Chicago";
