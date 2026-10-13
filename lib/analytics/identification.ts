/**
 * 1:N IDENTIFICATION metrics only: a captured muzzle searched against the whole enrolled gallery (N animals).
 * Each labelled search is MATED (the animal is enrolled; its true MOOZZLE ID is known) or NON-MATED (not enrolled).
 *   FPIR(t, k) = non-mated searches returning ≥ 1 candidate with score ≥ t in the top k ÷ non-mated searches
 *   FNIR(t, k) = mated searches whose true mate is NOT returned in the top k with score ≥ t ÷ mated searches
 *   Rank-r identification rate = mated searches whose true mate is at rank ≤ r ÷ mated searches
 * Never mix with 1:1 FAR / FRR.
 */
import type { ScanAnalyticsRow } from '@/store/types';
import { type Proportion, ruleOfThree, wilson } from './statistics';

export interface IdentificationTrial {
  mated: boolean;
  /** 1-based rank of the true mate in the returned list; null when absent or non-mated. */
  mateRank: number | null;
  /** Candidate scores in rank order. */
  scores: number[];
  gallerySize: number;
}

export function identificationTrials(rows: ScanAnalyticsRow[]): IdentificationTrial[] {
  return rows
    .filter((row) => row.scan_type === 'identify' && row.mated !== null)
    .map((row) => ({
      mated: row.mated === true,
      mateRank: row.mated ? row.mate_rank : null,
      scores: (row.candidate_scores ?? []).map(Number).filter((v) => Number.isFinite(v)),
      gallerySize: row.templates_searched,
    }));
}

function mateHit(trial: IdentificationTrial, threshold: number, k: number): boolean {
  if (!trial.mated || trial.mateRank === null || trial.mateRank > k) return false;
  const score = trial.scores[trial.mateRank - 1];
  return score !== undefined && score >= threshold;
}

/** A non-mated search falsely selects when any of its top-k candidates reaches the threshold (equivalently the top one). */
function falseSelection(trial: IdentificationTrial, threshold: number, k: number): boolean {
  return !trial.mated && trial.scores.slice(0, k).some((score) => score >= threshold);
}

export interface IdentificationSummary {
  threshold: number;
  k: number;
  mated: number;
  nonMated: number;
  fpir: Proportion;
  fnir: Proportion;
  rank1: Proportion;
  rankK: Proportion;
}

export function identificationSummary(trials: IdentificationTrial[], threshold: number, k: number): IdentificationSummary {
  const mated = trials.filter((t) => t.mated);
  const nonMated = trials.filter((t) => !t.mated);
  const misses = mated.filter((t) => !mateHit(t, threshold, k)).length;
  const falsePositives = nonMated.filter((t) => falseSelection(t, threshold, k)).length;
  const rank1Hits = mated.filter((t) => mateHit(t, threshold, 1)).length;
  return {
    threshold,
    k,
    mated: mated.length,
    nonMated: nonMated.length,
    fpir: wilson(falsePositives, nonMated.length),
    fnir: wilson(misses, mated.length),
    rank1: wilson(rank1Hits, mated.length),
    rankK: wilson(mated.length - misses, mated.length),
  };
}

/** Cumulative match characteristic: rank-r identification rate regardless of threshold. */
export function cmc(trials: IdentificationTrial[], maxRank: number): { rank: number; rate: number | null }[] {
  const mated = trials.filter((t) => t.mated);
  return Array.from({ length: maxRank }, (_, i) => {
    const rank = i + 1;
    const hits = mated.filter((t) => t.mateRank !== null && t.mateRank <= rank).length;
    return { rank, rate: mated.length ? hits / mated.length : null };
  });
}

export function fpirFnirCurve(trials: IdentificationTrial[], k: number, from = 0.5, to = 0.99, step = 0.01): { threshold: number; fpir: number | null; fnir: number | null }[] {
  const out: { threshold: number; fpir: number | null; fnir: number | null }[] = [];
  for (let t = from; t <= to + 1e-9; t += step) {
    const threshold = Math.round(t * 100) / 100;
    const s = identificationSummary(trials, threshold, k);
    out.push({ threshold, fpir: s.fpir.rate, fnir: s.fnir.rate });
  }
  return out;
}

export const GALLERY_SIZES = [100, 1000, 10000, 100000] as const;

/**
 * Modelled FPIR for a gallery of N independent animals given the per-comparison false-match rate (FMR):
 * FPIR(N) ≈ 1 − (1 − FMR)^N. A projection from 1:1 impostor statistics, not a measured 1:N rate.
 */
export function projectFpir(fmr: number, galleryN: number): number {
  if (!(fmr > 0)) return 0;
  if (fmr >= 1) return 1;
  return 1 - Math.exp(galleryN * Math.log1p(-fmr));
}

export interface GalleryProjection {
  n: number;
  /** From the observed FMR. */
  expected: number | null;
  /** From the 95 % upper bound of FMR (rule of three when zero false matches were seen). */
  upper: number | null;
}

export function galleryProjection(falseMatches: number, impostorComparisons: number, sizes: readonly number[]): GalleryProjection[] {
  const fmr = wilson(falseMatches, impostorComparisons);
  const upperFmr = impostorComparisons > 0 ? (falseMatches === 0 ? ruleOfThree(impostorComparisons) : fmr.high) : null;
  return sizes.map((n) => ({
    n,
    expected: fmr.rate === null ? null : projectFpir(fmr.rate, n),
    upper: upperFmr === null ? null : projectFpir(upperFmr, n),
  }));
}
