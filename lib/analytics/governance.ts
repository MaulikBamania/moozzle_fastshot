import type { BiometricConfigRow } from '@/store/types';

/** Editable threshold proposal; validated here with the same ranges the server enforces. */
export interface ProposalDraft {
  verify_accept: string;
  verify_review: string;
  identify_accept: string;
  identify_review: string;
  identify_margin: string;
  candidate_list_k: string;
  model_version: string;
  validation_reference: string;
  reason: string;
}

export function draftFrom(c: BiometricConfigRow | undefined): ProposalDraft {
  return {
    verify_accept: c ? String(c.verify_accept) : '0.88',
    verify_review: c ? String(c.verify_review) : '0.70',
    identify_accept: c ? String(c.identify_accept) : '0.85',
    identify_review: c ? String(c.identify_review) : '0.70',
    identify_margin: c ? String(c.identify_margin) : '0.02',
    candidate_list_k: c ? String(c.candidate_list_k) : '5',
    model_version: c?.model_version ?? 'MOOZZLE-TextureHOG-v1',
    validation_reference: '',
    reason: '',
  };
}

/** Validates a proposal locally with the same ranges the server enforces. */
export function proposalError(d: ProposalDraft): string {
  const nums = [d.verify_accept, d.verify_review, d.identify_accept, d.identify_review].map(Number);
  if (nums.some((v) => !Number.isFinite(v) || v < 0.3 || v > 0.99)) return 'Thresholds must be numbers between 0.30 and 0.99 (accept thresholds at least 0.50).';
  if (Number(d.verify_accept) < 0.5 || Number(d.identify_accept) < 0.5) return 'Accept thresholds must be at least 0.50.';
  if (Number(d.verify_review) >= Number(d.verify_accept)) return '1:1 review threshold must be below the 1:1 accept threshold.';
  if (Number(d.identify_review) >= Number(d.identify_accept)) return '1:N review threshold must be below the 1:N accept threshold.';
  const margin = Number(d.identify_margin);
  if (!Number.isFinite(margin) || margin < 0 || margin > 0.2) return 'Margin must be between 0 and 0.20.';
  const k = Number(d.candidate_list_k);
  if (!Number.isInteger(k) || k < 1 || k > 20) return 'Candidate list k must be a whole number from 1 to 20.';
  if (d.validation_reference.trim().length < 5) return 'Reference the validation report or test session that supports this configuration.';
  if (d.reason.trim().length < 15) return 'Give a reason of at least 15 characters.';
  return '';
}
