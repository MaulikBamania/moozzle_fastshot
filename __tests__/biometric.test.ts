import { base64ToBytes, cosineSimilarity, downsample, EMBEDDING_DIM, extractEmbedding, measureQuality, requiredTrials, type GrayImage } from '@/lib/biometric/features';

function texture(seed: number, size = 128, shift = 0, noise = 0): GrayImage {
  const data = new Float32Array(size * size);
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const waves = Array.from({ length: 6 }, () => ({ fx: rand() * 0.6, fy: rand() * 0.6, p: rand() * 6 }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = waves.reduce((acc, w) => acc + Math.sin((x + shift) * w.fx + y * w.fy + w.p), 0);
      data[y * size + x] = 128 + 18 * v + noise * (rand() - 0.5);
    }
  }
  return { data, width: size, height: size };
}

function boxBlur(img: GrayImage): GrayImage {
  const { width, height } = img;
  const out = new Float32Array(img.data);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) sum += img.data[(y + dy) * width + x + dx];
      out[y * width + x] = sum / 9;
    }
  }
  return { data: out, width, height };
}

describe('biometric texture embedding', () => {
  it('produces a 256-D unit vector', () => {
    const v = extractEmbedding(texture(7));
    expect(v).toHaveLength(EMBEDDING_DIM);
    expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 4);
  });

  it('scores a re-capture of the same pattern above a different pattern', () => {
    const a = extractEmbedding(texture(7));
    const recapture = extractEmbedding(texture(7, 128, 2, 12));
    const other = extractEmbedding(texture(99));
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(a, recapture)).toBeGreaterThan(cosineSimilarity(a, other));
  });

  it('measures blur as lower Laplacian variance', () => {
    const sharp = texture(3, 128, 0, 40);
    const blurred = boxBlur(boxBlur(sharp));
    expect(measureQuality(sharp, 0.3).sharpness).toBeGreaterThan(measureQuality(blurred, 0.3).sharpness * 3);
    expect(downsample(sharp).width).toBe(64);
    expect(measureQuality(sharp, 0.3).contrast).toBeGreaterThan(5);
  });

  it('decodes base64 without atob', () => {
    expect(Array.from(base64ToBytes('AQID/w=='))).toEqual([1, 2, 3, 255]);
  });
});

describe('99.99% benchmark sample size', () => {
  it('needs about 30,000 zero-error impostor trials for FAR 1e-4 at 95%', () => {
    expect(requiredTrials(0.0001, 0.95)).toBe(29956);
    expect(requiredTrials(0, 0.95)).toBe(0);
  });
});
