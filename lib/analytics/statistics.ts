/**
 * Statistical helpers for biometric performance reporting (ISO/IEC 19795-1 style):
 * observed proportions always travel with their sample size and a 95 % Wilson score interval.
 */

/** Two-sided 95 % normal quantile. */
export const Z95 = 1.959964;

export interface Proportion {
  /** Observed errors (or successes). */
  k: number;
  /** Trials. */
  n: number;
  rate: number | null;
  low: number | null;
  high: number | null;
}

/** Wilson score interval; well behaved for small n and for k = 0 or k = n. */
export function wilson(k: number, n: number, z = Z95): Proportion {
  if (!(n > 0) || k < 0 || k > n) return { k, n, rate: null, low: null, high: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Rule of three: with zero errors in n independent trials the one-sided 95 % upper bound is ≈ 3 / n. */
export function ruleOfThree(n: number): number | null {
  return n > 0 ? Math.min(1, 3 / n) : null;
}

/** Most conservative 95 % upper bound available: rule of three when no errors were seen, else Wilson. */
export function upperBound95(p: Proportion): number | null {
  if (p.n <= 0) return null;
  if (p.k === 0) return Math.max(ruleOfThree(p.n) ?? 0, p.high ?? 0);
  return p.high;
}

/** Independent error-free trials needed so the 95 % upper bound reaches the target (rule of three). */
export function trialsForTarget(target: number): number {
  return target > 0 ? Math.ceil(3 / target) : Number.POSITIVE_INFINITY;
}

/** Below this many trials a rate is shown but flagged as not interpretable. */
export const MIN_REPORTABLE_TRIALS = 30;

export function formatPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  if (pct !== 0 && Math.abs(pct) < 10 ** -digits) return `${pct.toExponential(1)}%`;
  return `${pct.toFixed(digits)}%`;
}

export function formatCi(p: Proportion, digits = 2): string {
  if (p.low === null || p.high === null) return 'CI —';
  return `95% CI ${formatPct(p.low, digits)}–${formatPct(p.high, digits)}`;
}
