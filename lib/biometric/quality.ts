/**
 * Pre-comparison image quality assessment. A frame that fails any check is a Failure to Acquire (FTA):
 * it is never embedded, never compared and never counted as a biometric match or non-match.
 * The same rules run for enrolment, 1:N identification and 1:1 verification.
 */
import type { CaptureCondition, MuzzleDetection, QualityMetrics, QualityReason, QualityStatus } from '@/store/types';

/** Smallest source dimension that still resolves ridge/bead texture after the 256 px muzzle crop. */
export const MIN_SOURCE_PX = 480;

export const GOOD_STATUS: QualityStatus = 'GOOD IMAGE — READY TO SCAN';

export const EMPTY_DETECTION: MuzzleDetection = {
  muzzleDetected: false,
  species: 'unknown',
  box: null,
  focus: 'soft',
  lighting: 'good',
  patternVisible: false,
  occlusion: 'none',
  notes: '',
};

const STATUS_FOR: Record<QualityReason, QualityStatus> = {
  low_resolution: 'RESOLUTION TOO LOW — RETAKE',
  muzzle_not_detected: 'MUZZLE NOT DETECTED',
  too_far: 'MOVE CLOSER',
  too_dark: 'TOO DARK — IMPROVE LIGHTING',
  overexposed: 'TOO BRIGHT — REDUCE GLARE',
  blur: 'TOO BLURRY — RETAKE',
  obstructed: 'MUZZLE OBSTRUCTED — CLEAR THE NOSE',
  pattern_not_visible: 'PATTERN NOT CLEAR — RETAKE',
};

/** Short cause shown to the field user, and what to do about it. */
export const REASON_GUIDANCE: Record<QualityReason, { cause: string; fix: string }> = {
  low_resolution: { cause: 'The photo resolution is too low to show the muzzle pattern.', fix: 'Use the live camera instead of a forwarded or compressed photo.' },
  muzzle_not_detected: { cause: 'No bovine muzzle (nose pad with nostrils) was found in the frame.', fix: 'Point the camera straight at the nose of the cow or buffalo.' },
  too_far: { cause: 'The muzzle is too small in the frame.', fix: 'Fill the oval with the nose — hold the phone 15–25 cm away.' },
  too_dark: { cause: 'The muzzle is too dark.', fix: 'Turn the animal toward daylight or light the nose from the side with a torch.' },
  overexposed: { cause: 'Glare or direct sun is washing out the muzzle.', fix: 'Shade the nose with your hand or body and avoid direct flash.' },
  blur: { cause: 'The image is blurred by movement or focus.', fix: 'Hold the phone steady, wait for the animal to settle and tap to focus.' },
  obstructed: { cause: 'Part of the muzzle is covered (rope, hand, feed, mucus).', fix: 'Clear anything covering the nose and wipe it gently with a dry cloth.' },
  pattern_not_visible: { cause: 'The ridge and bead pattern is not visible.', fix: 'Wipe moisture or dirt off the nose and recapture in even light.' },
};

export const QUALITY_HINTS: Record<QualityStatus, string> = {
  'GOOD IMAGE — READY TO SCAN': 'Muzzle detected, in focus and evenly lit.',
  'MOVE CLOSER': REASON_GUIDANCE.too_far.fix,
  'TOO BLURRY — RETAKE': REASON_GUIDANCE.blur.fix,
  'TOO DARK — IMPROVE LIGHTING': REASON_GUIDANCE.too_dark.fix,
  'TOO BRIGHT — REDUCE GLARE': REASON_GUIDANCE.overexposed.fix,
  'MUZZLE OBSTRUCTED — CLEAR THE NOSE': REASON_GUIDANCE.obstructed.fix,
  'RESOLUTION TOO LOW — RETAKE': REASON_GUIDANCE.low_resolution.fix,
  'MUZZLE NOT DETECTED': REASON_GUIDANCE.muzzle_not_detected.fix,
  'PATTERN NOT CLEAR — RETAKE': REASON_GUIDANCE.pattern_not_visible.fix,
};

/** Resolution gate run before the AI detector is called. */
export function resolutionOk(width: number, height: number): boolean {
  return Math.min(width, height) >= MIN_SOURCE_PX;
}

/** Every failed check, ordered by what the user should fix first. */
export function assessQuality(d: MuzzleDetection, m: QualityMetrics | null, sourceWidth: number, sourceHeight: number): { status: QualityStatus; reasons: QualityReason[] } {
  const reasons: QualityReason[] = [];
  if (!resolutionOk(sourceWidth, sourceHeight)) reasons.push('low_resolution');
  if (!d.muzzleDetected || !d.box || !m) {
    reasons.push('muzzle_not_detected');
  } else {
    if (m.fill < 0.06 || Math.max(d.box[2], d.box[3]) < 0.26) reasons.push('too_far');
    if (m.brightness < 58 || (d.lighting === 'dark' && m.brightness < 85)) reasons.push('too_dark');
    if (m.overexposed > 0.2 || (d.lighting === 'glare' && m.overexposed > 0.08)) reasons.push('overexposed');
    if (m.sharpness < 22 || (d.focus === 'blurry' && m.sharpness < 90)) reasons.push('blur');
    if (d.occlusion === 'heavy' || (d.occlusion === 'partial' && !d.patternVisible)) reasons.push('obstructed');
    if (m.contrast < 14 || (!d.patternVisible && m.sharpness < 140 && d.occlusion !== 'partial')) reasons.push('pattern_not_visible');
  }
  return { status: reasons.length ? STATUS_FOR[reasons[0]] : GOOD_STATUS, reasons };
}

export function conditionOf(m: QualityMetrics | null): CaptureCondition {
  if (!m) return 'normal';
  if (m.brightness < 95) return 'low_light';
  if (m.overexposed > 0.08 || m.brightness > 200) return 'bright_glare';
  return 'normal';
}

export const CONDITION_LABELS: Record<CaptureCondition, string> = {
  normal: 'Normal light',
  low_light: 'Low light',
  bright_glare: 'Bright / glare',
};
