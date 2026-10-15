import { ANGLE_SLOTS, DUPLICATE_SIMILARITY, findDuplicateFrame, missingRequiredSlots, quadrantPaths, requiredSlotsFilled, targetSlot } from '@/lib/biometric/angles';
import { cosineSimilarity } from '@/lib/biometric/features';

function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}

describe('angle-guided slots', () => {
  it('targets Front, then Left, then Right, then optional views', () => {
    expect(targetSlot([])?.prompt).toBe('Capture Front View (0°)');
    expect(targetSlot([0])?.prompt).toBe('Capture Left View (~15° Left)');
    expect(targetSlot([0, 1])?.prompt).toBe('Capture Right View (~15° Right)');
    expect(targetSlot([0, 1, 2])?.angle).toBe('additional');
    expect(targetSlot([0, 1, 2, 3, 4])).toBeNull();
  });

  it('honours a tapped empty slot and refills a removed required slot first', () => {
    expect(targetSlot([0], 2)?.angle).toBe('right');
    expect(targetSlot([0, 1], 1)?.angle).toBe('right');
    expect(targetSlot([0, 2, 3])?.angle).toBe('left');
  });

  it('requires front, left and right regardless of count', () => {
    expect(requiredSlotsFilled([0, 2, 3])).toBe(false);
    expect(missingRequiredSlots([0, 2, 3]).map((s) => s.angle)).toEqual(['left']);
    expect(requiredSlotsFilled([0, 1, 2])).toBe(true);
    expect(ANGLE_SLOTS.filter((s) => s.required).map((s) => s.angle)).toEqual(['front', 'left', 'right']);
  });
});

describe('DUPLICATE_FRAME detection', () => {
  const a = unit([1, 2, 3, 4]);
  const b = unit([4, 3, 2, 1]);
  it('flags near-identical embeddings and reports the matched slot', () => {
    const nearA = unit([1, 2, 3, 4.0001]);
    expect(cosineSimilarity(a, nearA)).toBeGreaterThan(DUPLICATE_SIMILARITY);
    const match = findDuplicateFrame(nearA, 'new', [{ slot: 0, embedding: b, hash: 'x' }, { slot: 1, embedding: a, hash: 'y' }], cosineSimilarity);
    expect(match).toMatchObject({ slot: 1, identical: false });
  });

  it('flags byte-identical images by hash', () => {
    expect(findDuplicateFrame(b, 'same', [{ slot: 2, embedding: a, hash: 'same' }], cosineSimilarity)).toMatchObject({ slot: 2, identical: true, similarity: 1 });
  });

  it('accepts a distinct angle', () => {
    expect(findDuplicateFrame(b, 'new', [{ slot: 0, embedding: a, hash: 'old' }], cosineSimilarity)).toBeNull();
  });
});

describe('certificate quadrants', () => {
  it('maps frames by angle tag, not enrolment order', () => {
    const rows = [
      { image_path: 'r.jpg', frame_index: 1, capture_angle: 'right' as const },
      { image_path: 'f.jpg', frame_index: 2, capture_angle: 'front' as const },
      { image_path: 'l.jpg', frame_index: 3, capture_angle: 'left' as const },
    ];
    expect(quadrantPaths(rows, 'ref.jpg')).toEqual(['f.jpg', 'l.jpg', 'r.jpg']);
  });

  it('falls back to enrolment order for untagged legacy records', () => {
    const rows = [1, 2, 3].map((i) => ({ image_path: `${i}.jpg`, frame_index: i, capture_angle: null }));
    expect(quadrantPaths(rows, 'ref.jpg')).toEqual(['1.jpg', '2.jpg', '3.jpg']);
    expect(quadrantPaths([], 'ref.jpg')).toEqual(['ref.jpg', null, null]);
  });
});
