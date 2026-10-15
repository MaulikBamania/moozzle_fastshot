/**
 * Pre-comparison image quality assessment. A frame that fails any check is a Failure to Acquire (FTA):
 * it is never embedded, never compared and never counted as a biometric match or non-match.
 * The same rules run for enrolment, 1:N identification and 1:1 verification.
 */
import type { CaptureCondition, MuzzleDetection, QualityMetrics, QualityReason, QualityStatus, SurfaceContaminants } from '@/store/types';

/** Smallest source dimension that still resolves ridge/bead texture after the 256 px muzzle crop. */
export const MIN_SOURCE_PX = 480;

export const GOOD_STATUS: QualityStatus = 'GOOD IMAGE — READY TO SCAN';

/** Clipped-highlight share above which flash glare fails the frame (FLASH_GLARE). */
export const FLASH_GLARE_LIMIT = 0.08;

export const NO_CONTAMINANTS: SurfaceContaminants = { waterDroplets: false, salivaMucus: false, debris: false, foreignObject: false, description: null };

/** Field reason codes as logged in acquisition events and shown to supervisors. */
export const REASON_CODES: Record<QualityReason, string> = {
  low_resolution: 'LOW_RESOLUTION',
  muzzle_not_detected: 'MUZZLE_NOT_DETECTED',
  too_far: 'TOO_FAR',
  too_dark: 'TOO_DARK',
  overexposed: 'OVEREXPOSED',
  blur: 'BLUR',
  obstructed: 'OBSTRUCTED',
  pattern_not_visible: 'PATTERN_NOT_VISIBLE',
  surface_contaminant: 'CONTAMINATED_SURFACE',
  flash_glare: 'FLASH_GLARE',
};

export const EMPTY_DETECTION: MuzzleDetection = {
  muzzleDetected: false,
  species: 'unknown',
  box: null,
  focus: 'soft',
  lighting: 'good',
  patternVisible: false,
  occlusion: 'none',
  contaminants: NO_CONTAMINANTS,
  flashGlare: false,
  framing: 'no_animal',
  notes: '',
};

const STATUS_FOR: Record<QualityReason, QualityStatus> = {
  low_resolution: 'RESOLUTION TOO LOW — RETAKE',
  muzzle_not_detected: 'MUZZLE NOT DETECTED',
  too_far: 'MOVE CLOSER — FILL OVAL WITH MUZZLE',
  surface_contaminant: 'MUZZLE SURFACE CONTAMINATED — WIPE & RETAKE',
  flash_glare: 'HARSH FLASH GLARE — USE TORCH OR SHADE NOSE',
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
  too_far: { cause: 'The muzzle is too small in the frame — this looks like a head or full-body photo.', fix: 'Camera must be 15–30 cm from the bovine nose pad so dermal ridges and nostril grooves fill the viewfinder.' },
  surface_contaminant: { cause: 'Water droplets, saliva, leaves, or debris detected on the bovine nose pad.', fix: 'Please wipe muzzle clean with a dry cloth before scanning to preserve biometric ridge accuracy.' },
  flash_glare: { cause: 'Direct camera flash causes whiteout on moist dermal ridges.', fix: 'Turn off direct burst flash; use continuous torch LED or ambient diffused lighting.' },
  too_dark: { cause: 'The muzzle is too dark.', fix: 'Turn the animal toward daylight or light the nose from the side with a torch.' },
  overexposed: { cause: 'Direct sun or a very bright background is washing out the whole muzzle.', fix: 'Shade the nose with your hand or body, or turn the animal away from the sun.' },
  blur: { cause: 'The image is blurred by movement or focus.', fix: 'Hold the phone steady, wait for the animal to settle and tap to focus.' },
  obstructed: { cause: 'Part of the muzzle is covered (rope, hand, feed, mucus).', fix: 'Clear anything covering the nose and wipe it gently with a dry cloth.' },
  pattern_not_visible: { cause: 'The ridge and bead pattern is not visible.', fix: 'Wipe moisture or dirt off the nose and recapture in even light.' },
};

export const QUALITY_HINTS: Record<QualityStatus, string> = {
  'GOOD IMAGE — READY TO SCAN': 'Muzzle detected, in focus and evenly lit.',
  'MOVE CLOSER — FILL OVAL WITH MUZZLE': REASON_GUIDANCE.too_far.fix,
  'MUZZLE SURFACE CONTAMINATED — WIPE & RETAKE': REASON_GUIDANCE.surface_contaminant.fix,
  'HARSH FLASH GLARE — USE TORCH OR SHADE NOSE': REASON_GUIDANCE.flash_glare.fix,
  'TOO BLURRY — RETAKE': REASON_GUIDANCE.blur.fix,
  'TOO DARK — IMPROVE LIGHTING': REASON_GUIDANCE.too_dark.fix,
  'TOO BRIGHT — REDUCE GLARE': REASON_GUIDANCE.overexposed.fix,
  'MUZZLE OBSTRUCTED — CLEAR THE NOSE': REASON_GUIDANCE.obstructed.fix,
  'RESOLUTION TOO LOW — RETAKE': REASON_GUIDANCE.low_resolution.fix,
  'MUZZLE NOT DETECTED': REASON_GUIDANCE.muzzle_not_detected.fix,
  'PATTERN NOT CLEAR — RETAKE': REASON_GUIDANCE.pattern_not_visible.fix,
};

/**
 * High-visibility alerts for the field-actionable failures. Title and subtext are shown verbatim as
 * a prominent callout above the regular cause list.
 */
export const REASON_ALERTS: Partial<Record<QualityReason, { title: string; subtext: string; icon: 'water-outline' | 'flash-off-outline' | 'scan-outline' }>> = {
  surface_contaminant: {
    title: STATUS_FOR.surface_contaminant,
    subtext: `${REASON_GUIDANCE.surface_contaminant.cause} ${REASON_GUIDANCE.surface_contaminant.fix}`,
    icon: 'water-outline',
  },
  flash_glare: {
    title: STATUS_FOR.flash_glare,
    subtext: `${REASON_GUIDANCE.flash_glare.cause} ${REASON_GUIDANCE.flash_glare.fix}`,
    icon: 'flash-off-outline',
  },
  too_far: {
    title: STATUS_FOR.too_far,
    subtext: REASON_GUIDANCE.too_far.fix,
    icon: 'scan-outline',
  },
};

export function hasContaminant(c: SurfaceContaminants): boolean {
  return c.waterDroplets || c.salivaMucus || c.debris || c.foreignObject;
}

/** Human-readable list of what the detector flagged, e.g. "water droplets, leaves". */
export function contaminantSummary(c: SurfaceContaminants): string {
  const parts = [
    c.waterDroplets ? 'water droplets' : '',
    c.salivaMucus ? 'saliva / mucus' : '',
    c.debris ? 'leaves / dirt / feed' : '',
    c.foreignObject ? 'foreign object (hand, rope, tag)' : '',
  ].filter(Boolean);
  const list = parts.join(', ');
  return c.description ? `${list}${list ? ' — ' : ''}${c.description}` : list;
}

/** Resolution gate run before the AI detector is called. */
export function resolutionOk(width: number, height: number): boolean {
  return Math.min(width, height) >= MIN_SOURCE_PX;
}

/** Every failed check, ordered by what the user should fix first. */
export function assessQuality(d: MuzzleDetection, m: QualityMetrics | null, sourceWidth: number, sourceHeight: number): { status: QualityStatus; reasons: QualityReason[] } {
  const reasons: QualityReason[] = [];
  if (!resolutionOk(sourceWidth, sourceHeight)) reasons.push('low_resolution');
  // A head or full-body photo is a framing problem the user can fix by moving closer — not "no muzzle".
  const wideShot = d.framing === 'head' || d.framing === 'full_body';
  if (!d.muzzleDetected || !d.box || !m) {
    reasons.push(wideShot ? 'too_far' : 'muzzle_not_detected');
    if (hasContaminant(d.contaminants)) reasons.push('surface_contaminant');
  } else {
    if (wideShot || m.fill < 0.06 || Math.max(d.box[2], d.box[3]) < 0.26) reasons.push('too_far');
    if (hasContaminant(d.contaminants)) reasons.push('surface_contaminant');
    const specular = m.specular ?? 0;
    const flashGlare = d.flashGlare || specular > FLASH_GLARE_LIMIT || (m.overexposed > FLASH_GLARE_LIMIT && m.brightness <= 200);
    if (flashGlare) reasons.push('flash_glare');
    if (m.brightness < 58 || (d.lighting === 'dark' && m.brightness < 85)) reasons.push('too_dark');
    if (m.overexposed > 0.2 || m.brightness > 215 || (!flashGlare && d.lighting === 'glare' && m.overexposed > 0.04)) reasons.push('overexposed');
    if (m.sharpness < 22 || (d.focus === 'blurry' && m.sharpness < 90)) reasons.push('blur');
    if (d.occlusion === 'heavy' || (d.occlusion === 'partial' && !d.patternVisible)) reasons.push('obstructed');
    if (m.contrast < 14 || (!d.patternVisible && m.sharpness < 140 && d.occlusion !== 'partial')) reasons.push('pattern_not_visible');
  }
  return { status: reasons.length ? STATUS_FOR[reasons[0]] : GOOD_STATUS, reasons };
}

export function conditionOf(m: QualityMetrics | null): CaptureCondition {
  if (!m) return 'normal';
  if (m.brightness < 95) return 'low_light';
  if (m.overexposed > FLASH_GLARE_LIMIT || (m.specular ?? 0) > FLASH_GLARE_LIMIT || m.brightness > 200) return 'bright_glare';
  return 'normal';
}

export const CONDITION_LABELS: Record<CaptureCondition, string> = {
  normal: 'Normal light',
  low_light: 'Low light',
  bright_glare: 'Bright / glare',
};
