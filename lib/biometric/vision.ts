/**
 * AI Gateway vision call for muzzle detection.
 *
 * The image travels as a base64 data URL inside a plain JSON body. No FormData, Blob or file-URI
 * part is built: Android's native fetch throws "Unsupported FormDataPart implementation" for those.
 */
import { analyzeImage } from '@fastshot/ai';
import { BiometricError } from './errors';

const ANALYZE_JSON_PATH = '/v1/analyze/image';
const VISION_MODEL = 'gpt-4o';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_ATTEMPTS = 3;
/** Statuses meaning the JSON route is not accepted by this gateway build, not that the request failed. */
const ROUTE_MISMATCH = new Set([404, 405, 415]);

interface VisionRequest {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
  prompt: string;
}

class RouteMismatchError extends Error {}

function gatewayConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NEWELL_API_URL;
  const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
  if (!apiUrl || !projectId) {
    throw new BiometricError('AI muzzle detection is not configured for this build. Contact your administrator.');
  }
  const appKey = process.env.EXPO_PUBLIC_NEWELL_APP_KEY;
  return { apiUrl: apiUrl.replace(/\/+$/, ''), projectId, appKey };
}

function serverMessage(text: string): string {
  try {
    const data = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    const value = data.detail ?? data.message ?? data.error;
    if (typeof value === 'string') return value;
  } catch {
    // Body was not JSON; use the raw text below.
  }
  return text.slice(0, 160);
}

async function postJson({ base64, mimeType, prompt }: VisionRequest): Promise<string> {
  const { apiUrl, projectId, appKey } = gatewayConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl}${ANALYZE_JSON_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/plain, application/json',
        ...(appKey ? { 'X-Newell-App-Key': appKey } : {}),
      },
      body: JSON.stringify({
        project_id: projectId,
        image_url: `data:${mimeType};base64,${base64}`,
        mime_type: mimeType,
        prompt,
        model: VISION_MODEL,
        inject_branding: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (ROUTE_MISMATCH.has(response.status)) throw new RouteMismatchError(`HTTP ${response.status}`);
    if (response.status === 403) throw new BiometricError('AI muzzle detection rejected this app’s project key. Contact your administrator.');
    if (!response.ok) {
      const error = new Error(`AI muzzle detection failed (HTTP ${response.status}): ${serverMessage(text)}`);
      (error as Error & { retryable?: boolean }).retryable = response.status >= 500 || response.status === 429;
      throw error;
    }
    // Plain-text answers can carry keep-alive padding; JSON-wrapped answers carry the text in a field.
    const trimmed = text.trim();
    if (trimmed.startsWith('"')) return String(JSON.parse(trimmed));
    if (trimmed.startsWith('{') && !trimmed.includes('muzzle_detected')) {
      const data = JSON.parse(trimmed) as { result?: unknown; text?: unknown; content?: unknown };
      const value = data.result ?? data.text ?? data.content;
      if (typeof value === 'string') return value.trim();
    }
    return trimmed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeout = new Error('AI muzzle detection timed out. Check your connection and retry.');
      (timeout as Error & { retryable?: boolean }).retryable = true;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof BiometricError || error instanceof RouteMismatchError) return false;
  if (error instanceof Error && (error as Error & { retryable?: boolean }).retryable === true) return true;
  // fetch rejects with a TypeError ("Network request failed") when the connection drops.
  return error instanceof TypeError;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function friendly(error: unknown): BiometricError {
  if (error instanceof BiometricError) return error;
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : '';
  if (/network request failed|failed to fetch|network/i.test(message)) {
    return new BiometricError('Could not reach AI muzzle detection — check the phone’s internet connection and tap Retry.');
  }
  return new BiometricError(message || 'AI muzzle detection failed. Please retry.');
}

/** Sends one frame to the AI Gateway as JSON and returns the model's raw answer. */
export async function analyzeBase64Image(request: VisionRequest): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await postJson(request);
    } catch (error) {
      if (error instanceof RouteMismatchError) {
        console.warn('JSON vision route unavailable, using string-only gateway upload', error.message);
        return analyzeViaDataUrl(request);
      }
      console.error(`AI muzzle detection attempt ${attempt} failed`, error);
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      await wait(600 * attempt);
    }
  }
  throw friendly(lastError);
}

/**
 * Fallback for gateways without the JSON route. Passing a data URL makes the SDK send only string
 * fields (no file part), which Android's native fetch encodes without FormDataPart errors.
 */
async function analyzeViaDataUrl({ base64, mimeType, prompt }: VisionRequest): Promise<string> {
  try {
    return await analyzeImage({ imageUrl: `data:${mimeType};base64,${base64}`, prompt, injectBranding: false });
  } catch (error) {
    console.error('Gateway data-URL muzzle detection failed', error);
    throw friendly(error);
  }
}
