/** A biometric pipeline failure whose message is safe to show the user. */
export class BiometricError extends Error {}

/**
 * The AI muzzle detector, capture storage or matching server could not be reached or answered with a
 * server-side failure. Never a biometric result: the attempt is retried or held in the pending queue.
 */
export class ServiceUnavailableError extends BiometricError {}

export type FailureKind = 'service_unavailable' | 'quality' | 'error';

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const value = (error as { message: unknown }).message;
    if (typeof value === 'string') return value;
  }
  return '';
}

const SERVICE_PATTERNS = /failed to fetch|network request failed|networkerror|fetch failed|load failed|timed? ?out|could not reach|http 5\d\d|http 429|service unavailable|bad gateway|gateway time|no production biometric configuration|not configured for this build/i;

/** Sorts a failure into the workflow outcome it belongs to. */
export function classifyBiometricError(error: unknown): FailureKind {
  if (error instanceof ServiceUnavailableError) return 'service_unavailable';
  const message = messageOf(error);
  if (/^IMAGE QUALITY INSUFFICIENT/i.test(message)) return 'quality';
  if (SERVICE_PATTERNS.test(message)) return 'service_unavailable';
  return 'error';
}
