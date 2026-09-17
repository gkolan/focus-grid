/**
 * Locked priority engine configuration — contract section 41.2.
 * The end-user tuning editor lives in Settings. Changing any value here requires a
 * documented product decision, an engineVersion bump, and regenerated goldens.
 */
export interface PriorityConfig {
  readonly deadlineWeight: number;
  readonly effortWeight: number;
  readonly overdueWeight: number;
  readonly deadlineHorizonMinutes: number;
  readonly overdueSaturationMinutes: number;
  readonly staleAfterMinutes: number;
  readonly defaultBaseUrgency: number;
  readonly defaultBaseImportance: number;
  readonly meaningfulAxisDelta: number;
  readonly heartbeatMinutes: number;
  readonly engineVersion: "1.0";
}

export const PRIORITY_CONFIG: PriorityConfig = {
  deadlineWeight: 0.55,
  effortWeight: 0.25,
  overdueWeight: 0.2,
  deadlineHorizonMinutes: 20_160,
  overdueSaturationMinutes: 1_440,
  staleAfterMinutes: 10_080,
  defaultBaseUrgency: -0.6,
  defaultBaseImportance: 0,
  meaningfulAxisDelta: 0.05,
  heartbeatMinutes: 15,
  engineVersion: "1.0",
};

/** Fails fast at module load if the locked constants are ever edited invalid. */
export function assertValidConfig(c: PriorityConfig): void {
  const weights = [c.deadlineWeight, c.effortWeight, c.overdueWeight];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error("priority weights must be finite and nonnegative");
  }
  if (Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-9) {
    throw new Error("priority weights must sum to 1 within 1e-9");
  }
  const durations = [
    c.deadlineHorizonMinutes,
    c.overdueSaturationMinutes,
    c.staleAfterMinutes,
    c.heartbeatMinutes,
  ];
  if (durations.some((d) => !Number.isFinite(d) || d <= 0)) {
    throw new Error("durations must be positive and finite");
  }
}

assertValidConfig(PRIORITY_CONFIG);

/** User-adjustable knobs. Weights are normalised to sum to 1; anything invalid falls back. */
export interface PriorityTuning {
  deadlineWeight?: number;
  effortWeight?: number;
  overdueWeight?: number;
  overdueSaturationMinutes?: number;
  staleAfterMinutes?: number;
}

export function withTuning(base: PriorityConfig, t: PriorityTuning | null | undefined): PriorityConfig {
  if (!t) return base;
  const w = [t.deadlineWeight ?? base.deadlineWeight, t.effortWeight ?? base.effortWeight, t.overdueWeight ?? base.overdueWeight];
  const sum = w.reduce((a, b) => a + b, 0);
  const pos = (n: number | undefined, d: number) => (Number.isFinite(n) && (n as number) > 0 ? (n as number) : d);
  const cfg: PriorityConfig = {
    ...base,
    deadlineWeight: sum > 0 && w.every((x) => x >= 0 && Number.isFinite(x)) ? w[0] / sum : base.deadlineWeight,
    effortWeight: sum > 0 && w.every((x) => x >= 0 && Number.isFinite(x)) ? w[1] / sum : base.effortWeight,
    overdueWeight: sum > 0 && w.every((x) => x >= 0 && Number.isFinite(x)) ? w[2] / sum : base.overdueWeight,
    overdueSaturationMinutes: pos(t.overdueSaturationMinutes, base.overdueSaturationMinutes),
    staleAfterMinutes: pos(t.staleAfterMinutes, base.staleAfterMinutes),
  };
  try {
    assertValidConfig(cfg);
    return cfg;
  } catch {
    return base;
  }
}
