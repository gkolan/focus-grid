import { describe, expect, it } from "vitest";
import { FakeClock } from "./fake-clock";

describe("FakeClock", () => {
  it("does not tick on its own and advances only when told", () => {
    const c = new FakeClock("2026-01-01T00:00:00.000Z");
    const a = c.now();
    const b = c.now();
    expect(a.getTime()).toBe(b.getTime());
    c.advanceMinutes(15);
    expect(c.now().getTime() - a.getTime()).toBe(15 * 60_000);
  });
});
