/**
 * Acquisition and operational metrics, reported strictly apart from matching errors:
 *   FTA (failure to acquire) = frames rejected by the quality pre-check ÷ (rejected + accepted frames)
 *   FTE (failure to enrol)   = enrolment sessions without the minimum accepted frames ÷ (those + completed enrolment checks)
 *   Uncertain-match rate     = comparisons routed to REVIEW REQUIRED ÷ comparisons (per operation)
 * Service outages are counted on their own; they are neither quality failures nor biometric decisions.
 */
import type { AcquisitionEventRow, BiometricOperation, ScanAnalyticsRow } from '@/store/types';
import { type Proportion, wilson } from './statistics';

export interface OperationStats {
  comparisons: number;
  confirmed: number;
  review: number;
  noMatch: number;
  acceptedFrames: number;
  ftaEvents: number;
  serviceEvents: number;
  fta: Proportion;
  uncertain: Proportion;
}

export interface OperationalSummary {
  totalAttempts: number;
  byOperation: Record<BiometricOperation, OperationStats>;
  fte: Proportion;
  fteEvents: number;
  enrolmentChecks: number;
  serviceOutages: number;
  reviewRequested: number;
  reviewResolved: number;
  reviewResolution: Proportion;
  reviewDecisions: { confirmed: number; rejected: number; inconclusive: number };
  qualityReasons: { code: string; count: number }[];
}

const OP_OF_SCAN: Record<ScanAnalyticsRow['scan_type'], BiometricOperation> = { identify: 'identify', verify: 'verify', enrol_check: 'enrol' };

export function operationalSummary(rows: ScanAnalyticsRow[], events: AcquisitionEventRow[]): OperationalSummary {
  const blank = (): OperationStats => ({ comparisons: 0, confirmed: 0, review: 0, noMatch: 0, acceptedFrames: 0, ftaEvents: 0, serviceEvents: 0, fta: wilson(0, 0), uncertain: wilson(0, 0) });
  const byOperation: Record<BiometricOperation, OperationStats> = { identify: blank(), verify: blank(), enrol: blank() };
  for (const row of rows) {
    const op = byOperation[OP_OF_SCAN[row.scan_type]];
    op.comparisons += 1;
    op.acceptedFrames += Math.max(1, row.frames || 1);
    if (row.outcome === 'match') op.confirmed += 1;
    else if (row.outcome === 'uncertain') op.review += 1;
    else op.noMatch += 1;
  }
  let fteEvents = 0;
  let serviceOutages = 0;
  const reasons = new Map<string, number>();
  for (const event of events) {
    const op = byOperation[event.operation];
    if (event.event_type === 'failure_to_acquire') {
      op.ftaEvents += 1;
      const code = event.reason_code || 'unspecified';
      reasons.set(code, (reasons.get(code) ?? 0) + 1);
    } else if (event.event_type === 'service_unavailable') {
      op.serviceEvents += 1;
      serviceOutages += 1;
    } else {
      fteEvents += 1;
    }
  }
  for (const op of Object.values(byOperation)) {
    op.fta = wilson(op.ftaEvents, op.ftaEvents + op.acceptedFrames);
    op.uncertain = wilson(op.review, op.comparisons);
  }
  const enrolmentChecks = byOperation.enrol.comparisons;
  const requested = rows.filter((row) => row.review_status !== 'none');
  const resolved = requested.filter((row) => row.review_status === 'resolved');
  return {
    totalAttempts: rows.length + events.filter((e) => e.event_type !== 'failure_to_enrol').length,
    byOperation,
    fte: wilson(fteEvents, fteEvents + enrolmentChecks),
    fteEvents,
    enrolmentChecks,
    serviceOutages,
    reviewRequested: requested.length,
    reviewResolved: resolved.length,
    reviewResolution: wilson(resolved.length, requested.length),
    reviewDecisions: {
      confirmed: resolved.filter((row) => row.review_decision === 'confirmed').length,
      rejected: resolved.filter((row) => row.review_decision === 'rejected').length,
      inconclusive: resolved.filter((row) => row.review_decision === 'inconclusive').length,
    },
    qualityReasons: [...reasons.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  };
}
