import type { AnalyticsSpecies, GroundTruth, ScanAnalyticsRow, ScanType, ScanVerdict } from '@/store/types';
import { GOALS } from './goals';

/** Proposed validation goals (not performance claims) — see lib/analytics/goals.ts. */
export const FAR_TARGET = GOALS.far.target ?? 0.000001; // ≤ 0.0001 % long-term, 1:1 only
export const FRR_TARGET = GOALS.frr.target ?? 0.05; // ≤ 5 % initial, 1:1 only

export const THRESHOLD_MIN = 0.6;
export const THRESHOLD_MAX = 0.95;
export const THRESHOLD_STEP = 0.01;

export type DateRange = 'today' | '7d' | '30d' | 'all';
export const DATE_RANGES: { key: DateRange; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: 'all', label: 'All', days: 0 },
];

export type SpeciesFilter = 'All' | AnalyticsSpecies;
export const SPECIES_FILTERS: SpeciesFilter[] = ['All', 'Cattle', 'Buffalo', 'Crossbred'];

export const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  identify: '1:N Identify',
  verify: '1:1 Verify',
  enrol_check: '1:N Enrolment check',
};

/** A labelled trial: genuine (same animal) or impostor, and the similarity the engine produced. */
export interface Trial {
  genuine: boolean;
  score: number;
}

export interface Confusion {
  /** Genuine accepted (True Match). */
  tp: number;
  /** Genuine rejected (False Reject). */
  fn: number;
  /** Impostor accepted (False Accept). */
  fp: number;
  /** Impostor rejected (True Non-Match). */
  tn: number;
}

export interface RateSummary extends Confusion {
  genuine: number;
  impostor: number;
  far: number | null;
  frr: number | null;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface CurvePoint {
  threshold: number;
  far: number | null;
  frr: number | null;
  falseAccepts: number;
  falseRejects: number;
}

export interface EerPoint {
  threshold: number;
  rate: number;
}

/** The engine accepts a scan only when it returned a Confirmed match; Review and No-match are not acceptances. */
export function accepted(row: Pick<ScanAnalyticsRow, 'outcome'>): boolean {
  return row.outcome === 'match';
}

export function verdictOf(row: Pick<ScanAnalyticsRow, 'outcome' | 'ground_truth'>): ScanVerdict {
  if (!row.ground_truth) return 'Unlabelled';
  if (row.ground_truth === 'genuine') return accepted(row) ? 'True Match' : 'False Reject';
  return accepted(row) ? 'False Accept' : 'True Non-Match';
}

/** The ground truth implied by a verdict the reviewer picks. */
export function truthForVerdict(verdict: Exclude<ScanVerdict, 'Unlabelled'>): GroundTruth {
  return verdict === 'True Match' || verdict === 'False Reject' ? 'genuine' : 'impostor';
}

/** Verdicts a reviewer can choose for a scan, given the engine's decision. */
export function verdictChoices(row: Pick<ScanAnalyticsRow, 'outcome'>): [Exclude<ScanVerdict, 'Unlabelled'>, Exclude<ScanVerdict, 'Unlabelled'>] {
  return accepted(row) ? ['True Match', 'False Accept'] : ['True Non-Match', 'False Reject'];
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function summarise(rows: ScanAnalyticsRow[]): RateSummary {
  const c: Confusion = { tp: 0, fn: 0, fp: 0, tn: 0 };
  for (const row of rows) {
    switch (verdictOf(row)) {
      case 'True Match':
        c.tp += 1;
        break;
      case 'False Reject':
        c.fn += 1;
        break;
      case 'False Accept':
        c.fp += 1;
        break;
      case 'True Non-Match':
        c.tn += 1;
        break;
      default:
        break;
    }
  }
  const genuine = c.tp + c.fn;
  const impostor = c.fp + c.tn;
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, genuine);
  return {
    ...c,
    genuine,
    impostor,
    far: ratio(c.fp, impostor),
    frr: ratio(c.fn, genuine),
    accuracy: ratio(c.tp + c.tn, genuine + impostor),
    precision,
    recall,
    f1: precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null,
  };
}

export function trialsFromScans(rows: ScanAnalyticsRow[]): Trial[] {
  return rows
    .filter((row) => row.ground_truth && row.similarity !== null)
    .map((row) => ({ genuine: row.ground_truth === 'genuine', score: Number(row.similarity) }));
}

export function thresholdSteps(): number[] {
  const steps: number[] = [];
  const count = Math.round((THRESHOLD_MAX - THRESHOLD_MIN) / THRESHOLD_STEP);
  for (let i = 0; i <= count; i += 1) steps.push(Math.round((THRESHOLD_MIN + i * THRESHOLD_STEP) * 100) / 100);
  return steps;
}

/** A trial is accepted at threshold t when its similarity is at least t. */
export function rateAt(trials: Trial[], threshold: number): CurvePoint {
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
  return { threshold, far: ratio(falseAccepts, impostor), frr: ratio(falseRejects, genuine), falseAccepts, falseRejects };
}

export function curve(trials: Trial[]): CurvePoint[] {
  return thresholdSteps().map((threshold) => rateAt(trials, threshold));
}

/** Equal Error Rate: the threshold where FAR and FRR cross, linearly interpolated between steps. */
export function equalErrorRate(points: CurvePoint[]): EerPoint | null {
  const usable = points.filter((p): p is CurvePoint & { far: number; frr: number } => p.far !== null && p.frr !== null);
  if (usable.length === 0) return null;
  for (let i = 0; i < usable.length; i += 1) {
    const d = usable[i].far - usable[i].frr;
    if (d === 0) return { threshold: usable[i].threshold, rate: usable[i].far };
    if (i > 0) {
      const prev = usable[i - 1];
      const dPrev = prev.far - prev.frr;
      if (dPrev > 0 && d < 0) {
        const f = dPrev / (dPrev - d);
        return { threshold: prev.threshold + f * (usable[i].threshold - prev.threshold), rate: prev.far + f * (usable[i].far - prev.far) };
      }
    }
  }
  // No crossing inside 0.60–0.95: report the step where the two rates are closest.
  const closest = usable.reduce((best, p) => (Math.abs(p.far - p.frr) < Math.abs(best.far - best.frr) ? p : best));
  return { threshold: closest.threshold, rate: (closest.far + closest.frr) / 2 };
}

export function inRange(createdAt: string, range: DateRange, now = new Date()): boolean {
  const days = DATE_RANGES.find((item) => item.key === range)?.days ?? 0;
  if (days === 0) return true;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return new Date(createdAt).getTime() >= start.getTime();
}

export function filterScans(rows: ScanAnalyticsRow[], range: DateRange, species: SpeciesFilter): ScanAnalyticsRow[] {
  return rows.filter((row) => inRange(row.created_at, range) && (species === 'All' || row.species === species));
}

export function formatRate(value: number | null, digits = 2): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatScore(value: number | null): string {
  return value === null ? '—' : Number(value).toFixed(3);
}

const pad = (value: number) => String(value).padStart(2, '0');
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const hours = date.getHours();
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(hours % 12 || 12)}:${pad(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
}


/** Smallest impostor sample that can demonstrate FAR below the target with zero errors (rule of three, 95 %). */
export function trialsNeeded(target: number): number {
  return Math.ceil(3 / target);
}
