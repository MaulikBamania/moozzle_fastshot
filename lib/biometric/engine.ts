/**
 * Shared MOOZZLE biometric pipeline, identical for enrolment, 1:N identification and 1:1 verification:
 * 1. normalise the capture, 2. AI muzzle detection + bounding box (Fastshot AI Gateway vision),
 * 3. crop, 4. measured quality filter, 5. 256-D texture embedding, 6. server-side cosine search (pgvector).
 */
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import UPNG from 'upng-js';
import { supabase } from '@/lib/supabase';
import type {
  AcquisitionEventType,
  BiometricOperation,
  CaptureSource,
  IdentifyResult,
  MuzzleAnalysis,
  MuzzleDetection,
  PipelineStage,
  QualityMetrics,
  ValidationPayload,
  VerifyResult,
} from '@/store/types';
import { BiometricError, ServiceUnavailableError } from './errors';
import { base64ToBytes, downsample, ENGINE_MODEL, embeddingLiteral, extractEmbedding, measureQuality, qualityScore, rgbaToGray } from './features';
import { assessQuality, conditionOf, EMPTY_DETECTION, GOOD_STATUS, QUALITY_HINTS, REASON_GUIDANCE, resolutionOk } from './quality';
import { analyzeBase64Image } from './vision';

export { BiometricError, QUALITY_HINTS, ServiceUnavailableError };

export const CAPTURE_BUCKET = 'muzzle-captures';
const NORMALISED_WIDTH = 960;
const CROP_SIZE = 256;

/** Coarse capture-device label for performance breakdowns; never a personal device name. */
export function deviceLabel(source: CaptureSource): string {
  return `${Platform.OS} ${String(Platform.Version ?? '')}`.trim() + ` · ${source}`;
}

function isNetworkFailure(error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : '';
  return error instanceof TypeError || /failed to fetch|network request failed|networkerror|fetch failed|load failed|timed? ?out/i.test(message);
}

/** RPC errors caused by the connection become SERVICE UNAVAILABLE; decisions and denials pass through. */
function serviceAware(error: unknown, what: string): unknown {
  if (isNetworkFailure(error)) return new ServiceUnavailableError(`${what} could not be reached. Check your connection and retry.`);
  return error;
}

export const STAGE_LABELS: Record<PipelineStage, string> = {
  normalize: 'Normalising capture (960 px, colour-corrected)',
  detect: 'AI muzzle detection & bounding box',
  crop: 'Cropping muzzle region (256 × 256)',
  quality: 'Quality filter: focus, lighting, glare, fill',
  embed: 'Extracting 256-D ridge/groove texture embedding',
  search: 'Cosine similarity search against enrolled templates',
};

const DETECT_PROMPT = `You are the muzzle-detection stage of a cattle/buffalo biometric system.
Inspect the photo and answer ONLY with minified JSON, no prose, using exactly these keys:
{"muzzle_detected":boolean,"species":"cattle"|"buffalo"|"unknown","box":[x,y,w,h],"focus":"sharp"|"soft"|"blurry","lighting":"good"|"dark"|"glare","pattern_visible":boolean,"occlusion":"none"|"partial"|"heavy","notes":string}
Rules: muzzle_detected is true only if the bare nose pad (nasal planum with nostrils) of a bovine is visible.
box is the tight bounding box of that nose pad as fractions of image width/height (0-1, origin top-left); use null when not detected.
pattern_visible is true only if the ridge/groove/bead skin texture of the nose pad can be seen. notes: under 15 words.`;

function parseDetection(raw: string): MuzzleDetection {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new BiometricError('The AI muzzle detector returned an unreadable answer. Please retry.');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch (error) {
    console.error('Muzzle detector JSON parse failed', error);
    throw new BiometricError('The AI muzzle detector returned malformed data. Please retry.');
  }
  const boxRaw = Array.isArray(parsed.box) ? parsed.box.map(Number) : null;
  const box = boxRaw && boxRaw.length === 4 && boxRaw.every((v) => Number.isFinite(v))
    ? (normaliseBox(boxRaw as [number, number, number, number]))
    : null;
  const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
  return {
    muzzleDetected: parsed.muzzle_detected === true && box !== null,
    species: pick(parsed.species, ['cattle', 'buffalo', 'unknown'] as const, 'unknown'),
    box,
    focus: pick(parsed.focus, ['sharp', 'soft', 'blurry'] as const, 'soft'),
    lighting: pick(parsed.lighting, ['good', 'dark', 'glare'] as const, 'good'),
    patternVisible: parsed.pattern_visible === true,
    occlusion: pick(parsed.occlusion, ['none', 'partial', 'heavy'] as const, 'none'),
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 120) : '',
  };
}

function normaliseBox(b: [number, number, number, number]): [number, number, number, number] | null {
  // Accept percentages as well as fractions.
  const scale = b.some((v) => v > 1.5) ? 100 : 1;
  const [x, y, w, h] = b.map((v) => v / scale);
  if (w <= 0.01 || h <= 0.01) return null;
  const cx = Math.max(0, Math.min(1, x));
  const cy = Math.max(0, Math.min(1, y));
  return [cx, cy, Math.min(1 - cx, w), Math.min(1 - cy, h)];
}

/** Runs stages 1–5 on a captured or uploaded frame. AI failures are thrown — never replaced by a guess. */
export async function analyzeMuzzle(uri: string, onStage?: (stage: PipelineStage) => void, source: CaptureSource = 'camera'): Promise<MuzzleAnalysis> {
  const started = performance.now();
  onStage?.('normalize');
  const sourceRef = await ImageManipulator.manipulate(uri).renderAsync();
  const sourceWidth = sourceRef.width;
  const sourceHeight = sourceRef.height;
  const normalizedRef = await ImageManipulator.manipulate(uri).resize({ width: NORMALISED_WIDTH }).renderAsync();
  const normalized = await normalizedRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.86, base64: true });
  if (!normalized.base64) throw new BiometricError('The capture could not be encoded on this device.');

  // Resolution pre-check: a frame this small cannot show the pattern, so the AI detector is not called.
  if (!resolutionOk(sourceWidth, sourceHeight)) {
    const assessed = assessQuality(EMPTY_DETECTION, null, sourceWidth, sourceHeight);
    return {
      status: 'RESOLUTION TOO LOW — RETAKE',
      reasons: ['low_resolution'],
      hint: `${REASON_GUIDANCE.low_resolution.cause} ${REASON_GUIDANCE.low_resolution.fix} (${sourceWidth}×${sourceHeight} px)`,
      sourceWidth,
      sourceHeight,
      condition: 'normal',
      source,
      qualityScore: 0,
      metrics: null,
      detection: { ...EMPTY_DETECTION, notes: assessed.reasons.join(',') },
      embedding: null,
      imageUri: normalized.uri,
      imageBase64: normalized.base64,
      cropUri: null,
      processingMs: Math.round(performance.now() - started),
    };
  }

  onStage?.('detect');
  let raw: string;
  try {
    raw = await analyzeBase64Image({ base64: normalized.base64, mimeType: 'image/jpeg', prompt: DETECT_PROMPT });
  } catch (error) {
    console.error('AI muzzle detection unavailable', error);
    const message = error instanceof Error ? error.message : 'AI muzzle detection failed.';
    throw new ServiceUnavailableError(message);
  }
  const detection = parseDetection(raw);

  let metrics: QualityMetrics | null = null;
  let embedding: number[] | null = null;
  let cropUri: string | null = null;
  if (detection.muzzleDetected && detection.box) {
    onStage?.('crop');
    const [bx, by, bw, bh] = detection.box;
    const sidePx = Math.min(normalized.width, normalized.height, Math.max(32, Math.round(Math.max(bw * normalized.width, bh * normalized.height) * 1.08)));
    const centreX = (bx + bw / 2) * normalized.width;
    const centreY = (by + bh / 2) * normalized.height;
    const originX = Math.round(Math.max(0, Math.min(normalized.width - sidePx, centreX - sidePx / 2)));
    const originY = Math.round(Math.max(0, Math.min(normalized.height - sidePx, centreY - sidePx / 2)));
    const cropRef = await ImageManipulator.manipulate(normalized.uri)
      .crop({ originX, originY, width: sidePx, height: sidePx })
      .resize({ width: CROP_SIZE, height: CROP_SIZE })
      .renderAsync();
    const crop = await cropRef.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!crop.base64) throw new BiometricError('The muzzle crop could not be read on this device.');
    cropUri = crop.uri;
    const bytes = base64ToBytes(crop.base64);
    const png = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const rgba = new Uint8Array(UPNG.toRGBA8(png)[0]);
    const gray = rgbaToGray(rgba, png.width, png.height);

    onStage?.('quality');
    metrics = measureQuality(gray, bw * bh);
    if (assessQuality(detection, metrics, sourceWidth, sourceHeight).status === GOOD_STATUS) {
      onStage?.('embed');
      embedding = extractEmbedding(downsample(gray));
    }
  }
  const { status, reasons } = assessQuality(detection, metrics, sourceWidth, sourceHeight);
  const guidance = reasons.map((reason) => REASON_GUIDANCE[reason].cause).join(' ');
  return {
    status,
    reasons,
    hint: status === GOOD_STATUS ? QUALITY_HINTS[status] : `${guidance} ${QUALITY_HINTS[status]}${detection.notes ? ` (${detection.notes})` : ''}`,
    sourceWidth,
    sourceHeight,
    condition: conditionOf(metrics),
    source,
    qualityScore: metrics ? qualityScore(metrics) : 0,
    metrics,
    detection,
    embedding,
    imageUri: normalized.uri,
    imageBase64: normalized.base64,
    cropUri,
    processingMs: Math.round(performance.now() - started),
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const id = data.session?.user.id;
  if (!id) throw new BiometricError('Your session has expired. Sign in again to scan.');
  return id;
}

/** Uploads the normalised capture into the caller's private folder; returns the storage path. */
export async function uploadCapture(analysis: MuzzleAnalysis): Promise<string> {
  const userId = await currentUserId();
  const path = `${userId}/${Crypto.randomUUID()}.jpg`;
  const bytes = base64ToBytes(analysis.imageBase64);
  // Raw ArrayBuffer body (Supabase's documented React Native path) — never FormData/Blob, which
  // Android's native fetch rejects with "Unsupported FormDataPart implementation".
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { error } = await supabase.storage.from(CAPTURE_BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: false });
      // A retry after a lost response finds the object already stored — that is a success.
      if (!error || (attempt > 1 && /already exists|duplicate/i.test(error.message))) return path;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    console.error(`Capture upload attempt ${attempt} failed`, lastError);
  }
  const reason = lastError && typeof lastError === 'object' && 'message' in lastError ? String((lastError as { message: unknown }).message) : '';
  throw new ServiceUnavailableError(`The capture could not be uploaded${reason ? `: ${reason}` : ''}. Check your connection and retry.`);
}

/** Quality summary sent with every comparison; carries no image or template data. */
function qualityPayload(analysis: MuzzleAnalysis) {
  return {
    status: analysis.status,
    score: analysis.qualityScore,
    ...analysis.metrics,
    model: ENGINE_MODEL,
    device: deviceLabel(analysis.source),
    condition: analysis.condition,
  };
}

function requireEmbedding(analysis: MuzzleAnalysis): number[] {
  if (!analysis.embedding) throw new BiometricError(`Frame rejected: ${analysis.status}`);
  return analysis.embedding;
}

/** 1:N search. Additional frames are averaged server-side for a steadier score. */
export async function identifyMuzzle(frames: MuzzleAnalysis[], onStage?: (stage: PipelineStage) => void): Promise<IdentifyResult> {
  if (frames.length === 0) throw new BiometricError('Capture a muzzle image first.');
  onStage?.('search');
  const started = performance.now();
  const imagePath = await uploadCapture(frames[0]);
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await supabase.rpc('identify_muzzle', {
      p_embeddings: frames.map((frame) => embeddingLiteral(requireEmbedding(frame))),
      p_image_path: imagePath,
      p_quality: qualityPayload(frames[0]),
      p_processing_ms: Math.round(frames.reduce((sum, f) => sum + f.processingMs, 0) + performance.now() - started),
    });
  } catch (error) {
    throw serviceAware(error, 'The MOOZZLE matching server');
  }
  if (response.error) throw serviceAware(response.error, 'The MOOZZLE matching server');
  return { ...(response.data as Omit<IdentifyResult, 'image_path'>), image_path: imagePath };
}

export async function verifyMuzzle(moozzleId: string, analysis: MuzzleAnalysis, onStage?: (stage: PipelineStage) => void): Promise<VerifyResult> {
  onStage?.('search');
  const started = performance.now();
  const imagePath = await uploadCapture(analysis);
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await supabase.rpc('verify_muzzle', {
      p_moozzle_id: moozzleId.replace(/\s/g, ''),
      p_embedding: embeddingLiteral(requireEmbedding(analysis)),
      p_image_path: imagePath,
      p_quality: qualityPayload(analysis),
      p_processing_ms: Math.round(analysis.processingMs + performance.now() - started),
    });
  } catch (error) {
    throw serviceAware(error, 'The MOOZZLE matching server');
  }
  if (response.error) throw serviceAware(response.error, 'The MOOZZLE matching server');
  return response.data as VerifyResult;
}

export async function requestScanReview(scanId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('request_scan_review', { p_scan: scanId, p_note: note });
  if (error) throw error;
}

export interface AcquisitionEventInput {
  operation: BiometricOperation;
  eventType: AcquisitionEventType;
  analysis?: MuzzleAnalysis | null;
  reasonCode?: string;
  framesAttempted?: number;
  framesAccepted?: number;
  source?: CaptureSource;
}

/**
 * Records a Failure to Acquire, a service outage or a Failure to Enrol in its own log, separate from
 * matching results. Best effort: a logging failure never blocks the field workflow.
 */
export async function logAcquisitionEvent(input: AcquisitionEventInput): Promise<void> {
  const analysis = input.analysis ?? null;
  try {
    const { error } = await supabase.rpc('log_acquisition_event', {
      p: {
        operation: input.operation,
        event_type: input.eventType,
        reason_code: input.reasonCode ?? analysis?.reasons[0] ?? '',
        quality_status: analysis?.status ?? '',
        quality_score: analysis ? analysis.qualityScore : null,
        frames_attempted: input.framesAttempted ?? 1,
        frames_accepted: input.framesAccepted ?? 0,
        device_model: deviceLabel(analysis?.source ?? input.source ?? 'camera'),
        capture_condition: analysis?.condition ?? '',
      },
    });
    if (error) throw error;
  } catch (error) {
    console.error('Acquisition event could not be logged', error);
  }
}

export async function fetchValidation(mode: ValidationPayload['mode']): Promise<ValidationPayload> {
  const { data, error } = await supabase.rpc('biometric_validation', { p_mode: mode });
  if (error) throw error;
  return data as ValidationPayload;
}

export async function signedCaptureUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(CAPTURE_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
