/**
 * 1:1 VERIFICATION metrics only: a captured muzzle against the reference templates of ONE claimed MOOZZLE ID.
 * FAR = impostor comparisons accepted ÷ impostor comparisons; FRR = genuine comparisons rejected ÷ genuine
 * comparisons. Only controlled, labelled trials (genuine / impostor ground truth) are used — never
 * unlabelled operational scans. Never mix with 1:N FPIR / FNIR.
 */
import type { ScanAnalyticsRow } from '@/store/types';
import { type Proportion, wilson } from './statistics';

export interface VerificationTrial {
  genuine: boolean;
  score: number;
}

export function verificationTrials(rows: ScanAnalyticsRow[]): VerificationTrial[] {
  return rows
    .filter((row) => row.scan_type === 'verify' && row.ground_truth !== null && row.similarity !== null)
    .map((row) => ({ genuine: row.ground_truth === 'genuine', score: Number(row.similarity) }));
}

export interface VerificationSummary {
  threshold: number;
  genuine: number;
  impostor: number;
  falseAccepts: number;
  falseRejects: number;
  far: Proportion;
  frr: Proportion;
}

/** A comparison is accepted when its similarity is at or above the 1:1 accept threshold. */
export function verificationSummary(trials: VerificationTrial[], threshold: number): VerificationSummary {
  let genuine = 0;
  let impostor = 0;
  let falseAccepts = 0;
  let falseRejects = 0;
  for (const trial of trials) {
    if (trial.genuine) {
      genuine += 1;
      if (trial.score < threshold) falseRejects += 1;
    } else {
      impostor += 1;
      if (trial.score >= threshold) falseAccepts += 1;
    }
  }
  return { threshold, genuine, impostor, falseAccepts, falseRejects, far: wilson(falseAccepts, impostor), frr: wilson(falseRejects, genuine) };
}

export interface RocPoint {
  threshold: number;
  far: number;
  frr: number;
}

/** ROC / DET operating points across the full similarity range (needs both trial classes). */
export function rocPoints(trials: VerificationTrial[], step = 0.01): RocPoint[] {
  const hasBoth = trials.some((t) => t.genuine) && trials.some((t) => !t.genuine);
  if (!hasBoth) return [];
  const points: RocPoint[] = [];
  for (let i = 0; i <= Math.round(1 / step); i += 1) {
    const threshold = Math.round(i * step * 1000) / 1000;
    const s = verificationSummary(trials, threshold);
    points.push({ threshold, far: s.far.rate ?? 0, frr: s.frr.rate ?? 0 });
  }
  return points;
}

/** Equal error rate from ROC points: where FAR and FRR cross (linear interpolation). */
export function eerFromRoc(points: RocPoint[]): { threshold: number; rate: number } | null {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const da = a.far - a.frr;
    const db = b.far - b.frr;
    if (da === 0) return { threshold: a.threshold, rate: a.far };
    if (da > 0 && db <= 0) {
      const f = da / (da - db || 1);
      return { threshold: a.threshold + f * (b.threshold - a.threshold), rate: a.far + f * (b.far - a.far) };
    }
  }
  return null;
}
