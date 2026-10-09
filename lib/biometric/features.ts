/**
 * Pure pixel algorithms for the shared biometric pipeline: grayscale conversion, measured image quality,
 * and the 256-D ridge/groove texture descriptor (histogram of oriented gradients on the muzzle crop).
 * The same functions run for enrolment, 1:N identification and 1:1 verification.
 */
import type { QualityMetrics } from '@/store/types';

export const EMBEDDING_DIM = 256;
export const ENGINE_MODEL = 'MOOZZLE-TextureHOG-v1';
const GRID = 4;
const BINS = 16;

export interface GrayImage {
  data: Float32Array;
  width: number;
  height: number;
}

export function rgbaToGray(rgba: Uint8Array, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    data[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return { data, width, height };
}

/** Measured statistics: mean luminance, RMS contrast, Laplacian variance (focus) and clipped-highlight share. */
export function measureQuality(img: GrayImage, fill: number): QualityMetrics {
  const { data, width, height } = img;
  const n = data.length;
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < n; i += 1) {
    sum += data[i];
    if (data[i] > 245) bright += 1;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i += 1) varSum += (data[i] - mean) ** 2;
  const contrast = Math.sqrt(varSum / n);

  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = data[i - 1] + data[i + 1] + data[i - width] + data[i + width] - 4 * data[i];
      lapSum += lap;
      lapSq += lap * lap;
      count += 1;
    }
  }
  const lapMean = lapSum / count;
  const sharpness = lapSq / count - lapMean * lapMean;
  return {
    brightness: round(mean, 1),
    contrast: round(contrast, 1),
    sharpness: round(sharpness, 1),
    overexposed: round(bright / n, 3),
    fill: round(fill, 3),
  };
}

/** Composite 0–1 score from the measured metrics. */
export function qualityScore(m: QualityMetrics): number {
  const focus = clamp01(m.sharpness / 180);
  const light = 1 - clamp01(Math.abs(m.brightness - 135) / 110);
  const contrast = clamp01(m.contrast / 48);
  const fill = clamp01(m.fill / 0.35);
  const glare = 1 - clamp01(m.overexposed / 0.2);
  return round(0.32 * focus + 0.2 * light + 0.2 * contrast + 0.16 * fill + 0.12 * glare, 3);
}

/** 2×2 box downsample to halve resolution before descriptor extraction (reduces sensor noise). */
export function downsample(img: GrayImage): GrayImage {
  const w = Math.floor(img.width / 2);
  const h = Math.floor(img.height / 2);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = 2 * y * img.width + 2 * x;
      out[y * w + x] = (img.data[i] + img.data[i + 1] + img.data[i + img.width] + img.data[i + img.width + 1]) / 4;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * HOG texture embedding: global photometric normalisation → Sobel gradients → 4×4 spatial cells × 16
 * unsigned orientation bins with soft binning → per-cell L2-Hys normalisation → Hellinger (sqrt) →
 * zero-centring → L2. Cosine similarity of two embeddings is then a correlation in [-1, 1].
 */
export function extractEmbedding(img: GrayImage): number[] {
  const { width, height } = img;
  const n = width * height;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += img.data[i];
  mean /= n;
  let sd = 0;
  for (let i = 0; i < n; i += 1) sd += (img.data[i] - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i += 1) g[i] = (img.data[i] - mean) / sd;

  const hist = new Float64Array(GRID * GRID * BINS);
  const cellW = width / GRID;
  const cellH = height / GRID;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = g[i - width + 1] + 2 * g[i + 1] + g[i + width + 1] - g[i - width - 1] - 2 * g[i - 1] - g[i + width - 1];
      const gy = g[i + width - 1] + 2 * g[i + width] + g[i + width + 1] - g[i - width - 1] - 2 * g[i - width] - g[i - width + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag < 1e-6) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const pos = (angle / Math.PI) * BINS - 0.5;
      const b0 = ((Math.floor(pos) % BINS) + BINS) % BINS;
      const b1 = (b0 + 1) % BINS;
      const w1 = pos - Math.floor(pos);
      const cx = Math.min(GRID - 1, Math.floor(x / cellW));
      const cy = Math.min(GRID - 1, Math.floor(y / cellH));
      const base = (cy * GRID + cx) * BINS;
      hist[base + b0] += mag * (1 - w1);
      hist[base + b1] += mag * w1;
    }
  }

  for (let c = 0; c < GRID * GRID; c += 1) {
    const base = c * BINS;
    normaliseSlice(hist, base, BINS);
    for (let b = 0; b < BINS; b += 1) hist[base + b] = Math.min(hist[base + b], 0.3);
    normaliseSlice(hist, base, BINS);
  }

  const vec = Array.from(hist, (value) => Math.sqrt(value));
  const vMean = vec.reduce((acc, value) => acc + value, 0) / vec.length;
  const centred = vec.map((value) => value - vMean);
  const norm = Math.sqrt(centred.reduce((acc, value) => acc + value * value, 0)) || 1;
  return centred.map((value) => round(value / norm, 6));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function embeddingLiteral(vector: number[]): string {
  return `[${vector.map((value) => value.toFixed(6)).join(',')}]`;
}

/** Zero errors in N independent impostor trials bounds FAR below target at confidence c when N ≥ ln(1−c)/ln(1−FAR). */
export function requiredTrials(targetFar: number, confidence: number): number {
  if (!(targetFar > 0 && targetFar < 1 && confidence > 0 && confidence < 1)) return 0;
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - targetFar));
}

function normaliseSlice(arr: Float64Array, start: number, length: number) {
  let sq = 0;
  for (let i = start; i < start + length; i += 1) sq += arr[i] * arr[i];
  const norm = Math.sqrt(sq) + 1e-6;
  for (let i = start; i < start + length; i += 1) arr[i] /= norm;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < B64.length; i += 1) table[B64.charCodeAt(i)] = i;
  return table;
})();

/** Base64 → bytes without relying on atob/Buffer (Hermes-safe). */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/^data:[^,]+,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < len ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < len ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0;
    out[p++] = (a << 2) | (b >> 4);
    if (i + 2 < len) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < len) out[p++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, p);
}
