import { describe, expect, it } from "vitest";
import {
  PRIORITY_CONFIG,
  assertValidConfig,
  type PriorityConfig,
} from "./config";

describe("priority config (contract 41.2)", () => {
  it("locked weights sum to 1 and engine is 1.0", () => {
    const { deadlineWeight, effortWeight, overdueWeight } = PRIORITY_CONFIG;
    expect(deadlineWeight + effortWeight + overdueWeight).toBeCloseTo(1, 9);
    expect(PRIORITY_CONFIG.engineVersion).toBe("1.0");
    expect(() => assertValidConfig(PRIORITY_CONFIG)).not.toThrow();
  });

  it("rejects tampered weights", () => {
    const bad: PriorityConfig = { ...PRIORITY_CONFIG, deadlineWeight: 0.9 };
    expect(() => assertValidConfig(bad)).toThrow(/sum to 1/);
  });

  it("rejects non-positive durations", () => {
    const bad: PriorityConfig = { ...PRIORITY_CONFIG, heartbeatMinutes: 0 };
    expect(() => assertValidConfig(bad)).toThrow(/positive/);
  });
});
