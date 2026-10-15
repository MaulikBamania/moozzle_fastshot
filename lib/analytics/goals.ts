/**
 * Proposed validation goals. These are targets for the documented test protocol, NOT performance claims.
 * A goal is only "statistically supported" when the 95 % upper confidence bound of a labelled, controlled
 * evaluation is at or below it — and even then independent review is required before any public claim.
 */
import { type Proportion, upperBound95 } from './statistics';

export type GoalKey = 'far' | 'frr' | 'fpir' | 'fnir' | 'fta' | 'fte' | 'uncertain';

export interface PerformanceGoal {
  key: GoalKey;
  metric: string;
  operation: '1:1 Verification' | '1:N Identification' | 'Acquisition / Operational';
  /** null = no numeric target yet; measured separately. */
  target: number | null;
  targetLabel: string;
  note: string;
}

export const GOALS: Record<GoalKey, PerformanceGoal> = {
  far: { key: 'far', metric: 'FAR', operation: '1:1 Verification', target: 0.000001, targetLabel: '≤ 0.0001% (long-term)', note: 'Defined 1:1 test protocol, labelled impostor comparisons only.' },
  frr: { key: 'frr', metric: 'FRR', operation: '1:1 Verification', target: 0.05, targetLabel: '≤ 5% (initial)', note: 'At the selected 1:1 security threshold, labelled genuine comparisons only.' },
  fpir: { key: 'fpir', metric: 'FPIR', operation: '1:N Identification', target: null, targetLabel: 'To be set from 1:N testing', note: 'Explicit target to be fixed through 1:N tests at the intended production gallery size.' },
  fnir: { key: 'fnir', metric: 'FNIR', operation: '1:N Identification', target: null, targetLabel: 'To be set from 1:N testing', note: 'Explicit target to be fixed through 1:N tests at the intended production gallery size.' },
  fta: { key: 'fta', metric: 'Image-quality failure rate (FTA)', operation: 'Acquisition / Operational', target: null, targetLabel: 'Measured separately', note: 'Failed acquisitions are never counted as matches or non-matches.' },
  fte: { key: 'fte', metric: 'Failure-to-enrol rate (FTE)', operation: 'Acquisition / Operational', target: null, targetLabel: 'Measured separately', note: 'Enrolment sessions that could not produce the minimum accepted frames.' },
  uncertain: { key: 'uncertain', metric: 'Uncertain-match rate', operation: 'Acquisition / Operational', target: null, targetLabel: 'Measured separately', note: 'Share of comparisons routed to REVIEW REQUIRED.' },
};

export type GoalStatus = 'no_data' | 'no_target' | 'not_demonstrated' | 'supported' | 'not_met';

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  no_data: 'No labelled trials',
  no_target: 'Measured — no target set',
  not_demonstrated: 'Not demonstrated',
  supported: 'Statistically supported — independent review pending',
  not_met: 'Not met',
};

/** Compares the 95 % confidence interval, not the point estimate, with the target. */
export function assessGoal(p: Proportion, target: number | null): GoalStatus {
  if (p.n <= 0) return 'no_data';
  if (target === null) return 'no_target';
  const upper = upperBound95(p);
  if (upper !== null && upper <= target) return 'supported';
  if (p.low !== null && p.low > target) return 'not_met';
  return 'not_demonstrated';
}
