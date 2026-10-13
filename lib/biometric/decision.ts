/**
 * Five-outcome decision workflow shared by 1:N identification, 1:1 verification and enrolment.
 * The server applies the approved thresholds; the app only maps the result to what the user may do next.
 * A field user can never turn a REVIEW REQUIRED or NO ACCEPTED MATCH into an identity.
 */
import type { BiometricDecision, DecisionReason, MatchOutcome } from '@/store/types';

export function decisionForOutcome(outcome: MatchOutcome): BiometricDecision {
  switch (outcome) {
    case 'match':
      return 'MATCH_CONFIRMED';
    case 'uncertain':
      return 'REVIEW_REQUIRED';
    default:
      return 'NO_ACCEPTED_MATCH';
  }
}

export interface DecisionCopy {
  title: string;
  tone: 'green' | 'amber' | 'red' | 'slate';
  icon: 'shield-checkmark' | 'people-circle' | 'close-circle' | 'image' | 'cloud-offline';
  summary: string;
  /** True only for results that are a biometric comparison (counted in FAR/FRR/FPIR/FNIR). */
  comparison: boolean;
}

export const DECISION_COPY: Record<BiometricDecision, DecisionCopy> = {
  MATCH_CONFIRMED: {
    title: 'MATCH CONFIRMED',
    tone: 'green',
    icon: 'shield-checkmark',
    summary: 'The similarity satisfies the approved acceptance rules for this operation.',
    comparison: true,
  },
  REVIEW_REQUIRED: {
    title: 'POSSIBLE MATCH — REVIEW REQUIRED',
    tone: 'amber',
    icon: 'people-circle',
    summary: 'No identity is confirmed. An authorised reviewer must compare the muzzles before any decision.',
    comparison: true,
  },
  NO_ACCEPTED_MATCH: {
    title: 'NO ACCEPTED MATCH',
    tone: 'red',
    icon: 'close-circle',
    summary: 'No identity is claimed. Recapture the muzzle or use the authorised enrolment workflow.',
    comparison: true,
  },
  IMAGE_QUALITY_INSUFFICIENT: {
    title: 'IMAGE QUALITY INSUFFICIENT',
    tone: 'amber',
    icon: 'image',
    summary: 'The frame failed the quality pre-check. It was not compared and does not count as a match or non-match.',
    comparison: false,
  },
  SERVICE_UNAVAILABLE: {
    title: 'SERVICE UNAVAILABLE',
    tone: 'slate',
    icon: 'cloud-offline',
    summary: 'The biometric service could not be reached. Nothing was decided and no record was created.',
    comparison: false,
  },
};

export const REASON_TEXT: Record<DecisionReason, string> = {
  accepted: 'Top similarity met the accept threshold and was clear of every other candidate.',
  between_thresholds: 'Similarity is between the review and accept thresholds.',
  ambiguous_margin: 'Similarity met the accept threshold, but another enrolled animal scored too close to be sure.',
  below_review_threshold: 'Similarity is below the review threshold.',
};

export function reasonText(reason: string | null | undefined): string {
  return reason && reason in REASON_TEXT ? REASON_TEXT[reason as DecisionReason] : '';
}
