/**
 * Injected clock (contract 37.5.4, 40.4). Domain code never reads the system
 * clock directly — every pass receives one captured instant.
 */
export interface Clock {
  now(): Date;
}

/** Production clock. The only place a real `Date` is read for domain use. */
export const systemClock: Clock = {
  now: () => new Date(),
};
