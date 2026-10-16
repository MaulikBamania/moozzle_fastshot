/**
 * Angle-guided enrolment slots. Slots 1–3 match the certificate's Front / Left / Right View
 * quadrants and are required; slots 4–5 are optional extra views.
 */
import type { CaptureAngle } from '@/store/types';

export interface AngleSlot {
  index: number;
  angle: CaptureAngle;
  required: boolean;
  title: string;
  subtitle: string;
  /** Primary capture / upload prompt while this slot is the target. */
  prompt: string;
  /** Viewfinder HUD badge. */
  badge: string;
  /** Positioning advice shown on the viewfinder while this slot is the target. */
  hint: string;
  /** Which way the technician should move the camera for this angle. */
  direction: GuideDirection;
}

export type GuideDirection = 'center' | 'left' | 'right' | 'up';

export const ANGLE_SLOTS: readonly AngleSlot[] = [
  { index: 0, angle: 'front', required: true, title: 'Front View (0°)', subtitle: 'Direct center alignment with nostrils', prompt: 'Capture Front View (0°)', badge: 'TARGET: FRONT VIEW (0°)', hint: 'Hold the camera directly level with the nostrils, 20–30 cm away.', direction: 'center' },
  { index: 1, angle: 'left', required: true, title: 'Left View (~15° Left)', subtitle: 'Slight angle from animal’s left', prompt: 'Capture Left View (~15° Left)', badge: 'TARGET: LEFT VIEW (~15° LEFT)', hint: 'Step slightly to the animal’s left side and turn the camera ~15° toward the muzzle.', direction: 'left' },
  { index: 2, angle: 'right', required: true, title: 'Right View (~15° Right)', subtitle: 'Slight angle from animal’s right', prompt: 'Capture Right View (~15° Right)', badge: 'TARGET: RIGHT VIEW (~15° RIGHT)', hint: 'Step slightly to the animal’s right side and turn the camera ~15° toward the muzzle.', direction: 'right' },
  { index: 3, angle: 'additional', required: false, title: 'Additional View', subtitle: 'Nasal bridge / top angle', prompt: 'Capture Additional View', badge: 'TARGET: ADDITIONAL VIEW (OPTIONAL)', hint: 'Raise the camera slightly to include the nasal bridge above the nostrils.', direction: 'up' },
  { index: 4, angle: 'additional', required: false, title: 'Additional View', subtitle: 'Nasal bridge / top angle', prompt: 'Capture Additional View', badge: 'TARGET: ADDITIONAL VIEW (OPTIONAL)', hint: 'Raise the camera slightly to include the nasal bridge above the nostrils.', direction: 'up' },
];

export const REQUIRED_SLOT_COUNT = ANGLE_SLOTS.filter((slot) => slot.required).length;

/** Cosine similarity above which a new frame counts as the same shot as an accepted one. */
export const DUPLICATE_SIMILARITY = 0.9995;

export const ANGLE_NAMES: Record<CaptureAngle, string> = {
  front: 'Front View',
  left: 'Left View',
  right: 'Right View',
  additional: 'Additional View',
};

/** The slot to fill next: the preferred slot when it is still empty, otherwise the first empty slot (or null when all are full). */
export function targetSlot(filled: readonly number[], preferred: number | null = null): AngleSlot | null {
  if (preferred !== null && ANGLE_SLOTS[preferred] && !filled.includes(preferred)) return ANGLE_SLOTS[preferred];
  return ANGLE_SLOTS.find((slot) => !filled.includes(slot.index)) ?? null;
}

export function requiredSlotsFilled(filled: readonly number[]): boolean {
  return ANGLE_SLOTS.every((slot) => !slot.required || filled.includes(slot.index));
}

/** Required slots still missing, in capture order. */
export function missingRequiredSlots(filled: readonly number[]): AngleSlot[] {
  return ANGLE_SLOTS.filter((slot) => slot.required && !filled.includes(slot.index));
}

export interface DuplicateCandidate {
  slot: number;
  embedding: number[] | null;
  hash: string | null;
}

/**
 * Finds the accepted frame a new frame repeats: identical image bytes (hash), or texture
 * embeddings above DUPLICATE_SIMILARITY. Returns the closest match, or null when the frame is distinct.
 */
export function findDuplicateFrame(
  embedding: number[],
  hash: string | null,
  accepted: readonly DuplicateCandidate[],
  similarity: (a: number[], b: number[]) => number,
): { slot: number; similarity: number; identical: boolean } | null {
  let best: { slot: number; similarity: number; identical: boolean } | null = null;
  for (const frame of accepted) {
    const identical = !!hash && frame.hash === hash;
    const score = frame.embedding ? similarity(frame.embedding, embedding) : 0;
    if (!identical && score <= DUPLICATE_SIMILARITY) continue;
    const value = identical ? 1 : score;
    if (!best || value > best.similarity || (identical && !best.identical)) best = { slot: frame.slot, similarity: value, identical };
  }
  return best;
}

export interface TemplateFrameRow {
  image_path: string | null;
  frame_index: number;
  capture_angle: CaptureAngle | null;
}

/**
 * Maps enrolment frames to the Front / Left / Right View quadrants by their recorded angle tag.
 * Records enrolled before angle-guided capture have no tag and fall back to enrolment order.
 */
export function quadrantPaths(rows: readonly TemplateFrameRow[], reference: string | null | undefined): [string | null, string | null, string | null] {
  const listed = rows.filter((row): row is TemplateFrameRow & { image_path: string } => !!row.image_path);
  const tagged = (angle: CaptureAngle) => listed.find((row) => row.capture_angle === angle)?.image_path ?? null;
  if (listed.some((row) => row.capture_angle)) return [tagged('front') ?? reference ?? null, tagged('left'), tagged('right')];
  const ordered = listed.length ? listed.map((row) => row.image_path) : [reference ?? null];
  return [ordered[0] ?? null, ordered[1] ?? null, ordered[2] ?? null];
}
