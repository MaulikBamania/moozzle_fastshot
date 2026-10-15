import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { colors, PipelineList, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { QUALITY_HINTS, signedCaptureUrl, STAGE_LABELS } from '@/lib/biometric/engine';
import { GOOD_STATUS, REASON_GUIDANCE } from '@/lib/biometric/quality';
import type { GuideDirection } from '@/lib/biometric/angles';
import type { CaptureSource, MuzzleAnalysis, PipelineStage, QualityStatus } from '@/store/types';

const GOOD: QualityStatus = GOOD_STATUS;
const WARN_STATUSES: QualityStatus[] = ['MOVE CLOSER', 'PATTERN NOT CLEAR — RETAKE', 'TOO BRIGHT — REDUCE GLARE', 'MUZZLE OBSTRUCTED — CLEAR THE NOSE'];

export function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    const message = (error as { message: string }).message.replace(/^permission_denied:\s*/, 'Not permitted: ');
    return message || fallback;
  }
  return fallback;
}

/** Angle guidance for the viewfinder: positioning advice plus a directional arrow. */
export interface CaptureGuidance {
  hint: string;
  direction: GuideDirection;
}

const DIRECTION_ICONS: Record<GuideDirection, keyof typeof Ionicons.glyphMap> = {
  center: 'locate',
  left: 'arrow-back-circle',
  right: 'arrow-forward-circle',
  up: 'arrow-up-circle',
};

const IS_WEB = process.env.EXPO_OS === 'web';

/**
 * Live camera viewfinder with muzzle guide, flip/torch toggles, a shutter that is always visible
 * (it starts the camera first when needed) and a gallery upload alternative.
 */
export function MuzzleCapture({
  onFrame,
  busy,
  captureLabel = 'Capture & Identify',
  uploadLabel = 'Upload Muzzle Photo',
  disabled = false,
  feedback,
  targetBadge,
  guidance,
  duplicate,
}: {
  onFrame: (uri: string, source: CaptureSource) => void;
  busy: boolean;
  captureLabel?: string;
  uploadLabel?: string;
  disabled?: boolean;
  feedback?: MuzzleAnalysis | null;
  /** Angle guidance shown at the top of the viewfinder, e.g. "TARGET: FRONT VIEW (0°)". */
  targetBadge?: string | null;
  /** Positioning advice and direction arrow for the current target angle. */
  guidance?: CaptureGuidance | null;
  /** Set when the last frame repeated an accepted frame; replaces the quality banner. */
  duplicate?: DuplicateFrameNotice | null;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const cameraRef = useRef<CameraView>(null);
  // The camera runs only once permission is granted; a mount failure falls back to photo upload.
  const cameraOn = !!permission?.granted && !mountFailed;
  const blocked = !!permission && !permission.granted && !permission.canAskAgain;

  const startCamera = useCallback(async () => {
    setError('');
    setMountFailed(false);
    setRequesting(true);
    try {
      const result = await requestPermission();
      if (!result.granted) setError(result.canAskAgain ? 'Camera access was declined. Allow it to capture live, or upload a muzzle photo instead.' : 'Camera access is blocked for this app. Enable it in Settings, or upload a muzzle photo.');
    } catch (caught) {
      console.error('Camera permission request failed', caught);
      setError('This device has no available camera. Upload a muzzle photo instead.');
    } finally {
      setRequesting(false);
    }
  }, [requestPermission]);

  const capture = useCallback(async () => {
    if (!cameraRef.current || !ready) return;
    setError('');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) throw new Error('No frame was returned by the camera.');
      onFrame(photo.uri, 'camera');
    } catch (caught) {
      console.error('Camera capture failed', caught);
      setError(errorText(caught, 'The camera could not capture a frame. Try again or upload a photo.'));
    }
  }, [onFrame, ready]);

  const upload = useCallback(async () => {
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.92, allowsEditing: false });
      if (result.canceled || !result.assets[0]?.uri) return;
      onFrame(result.assets[0].uri, 'upload');
    } catch (caught) {
      console.error('Photo upload failed', caught);
      setError(errorText(caught, 'The photo could not be opened. Choose a JPEG or PNG image.'));
    }
  }, [onFrame]);

  const shutter = useCallback(() => {
    if (cameraOn) void capture();
    else if (blocked && !IS_WEB) void Linking.openSettings();
    else void startCamera();
  }, [blocked, cameraOn, capture, startCamera]);

  const flip = useCallback(() => {
    setReady(false);
    setTorch(false);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, []);

  const status = feedback?.status;
  const tone = duplicate ? 'warn' : !status ? 'idle' : status === GOOD ? 'good' : WARN_STATUSES.includes(status) ? 'warn' : 'bad';
  const torchSupported = cameraOn && !IS_WEB && facing === 'back';
  const shutterLabel = cameraOn ? (ready ? captureLabel : 'Starting camera…') : blocked && !IS_WEB ? 'Open Settings to Enable Camera' : requesting ? 'Requesting camera…' : `Start Camera · ${captureLabel}`;
  const shutterDisabled = busy || disabled || requesting || (cameraOn && !ready);

  return (
    <View style={styles.wrap}>
      <View style={styles.viewfinder}>
        {cameraOn ? (
          <CameraView
            key={facing}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            enableTorch={torchSupported && torch}
            onCameraReady={() => setReady(true)}
            onMountError={(event) => {
              console.error('Camera mount error', event.message);
              setMountFailed(true);
              setReady(false);
              setError(`Camera unavailable: ${event.message}. Upload a muzzle photo instead.`);
            }}
          />
        ) : (
          <View style={styles.cameraOff}>
            <View style={styles.cameraOffIcon}><Ionicons name={blocked ? 'lock-closed-outline' : 'camera-outline'} size={24} color="#B8E9CC" /></View>
            <Text style={styles.cameraOffTitle}>{blocked ? 'Camera permission is blocked' : 'Live muzzle camera'}</Text>
            <Text style={styles.cameraOffText}>
              {blocked
                ? IS_WEB ? 'Allow camera access in your browser’s site settings, or upload a photo below.' : 'Enable camera access in Settings, or upload a photo below.'
                : 'Camera access lets you frame the muzzle live inside the guide. Frames are used only for this AI muzzle check.'}
            </Text>
          </View>
        )}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={[styles.oval, tone === 'good' && styles.ovalGood, tone === 'warn' && styles.ovalWarn, tone === 'bad' && styles.ovalBad]}>
            <View style={styles.nostrilRow}>
              <View style={[styles.nostril, styles.nostrilLeft]} />
              <View style={styles.bridge} />
              <View style={[styles.nostril, styles.nostrilRight]} />
            </View>
          </View>
          <Text style={[styles.ovalLabel, duplicate && styles.ovalLabelWarn]}>{duplicate ? 'CHANGE ANGLE' : 'ALIGN NOSTRILS IN GUIDE'}</Text>
        </View>
        {guidance && guidance.direction !== 'center' ? (
          <View pointerEvents="none" style={[styles.arrow, guidance.direction === 'left' && styles.arrowLeft, guidance.direction === 'right' && styles.arrowRight, guidance.direction === 'up' && styles.arrowUp]}>
            <Ionicons name={DIRECTION_ICONS[guidance.direction]} size={34} color="#FBBF24" />
          </View>
        ) : null}
        {targetBadge ? (
          <View pointerEvents="none" style={styles.hud}>
            <View style={styles.hudBadge}>
              <Ionicons name="locate-outline" size={13} color="#0B2735" />
              <Text style={styles.hudText} numberOfLines={1}>{targetBadge}</Text>
            </View>
          </View>
        ) : null}
        {guidance ? (
          <View pointerEvents="none" style={styles.hintBar}>
            <Ionicons name={DIRECTION_ICONS[guidance.direction]} size={15} color="#FBBF24" />
            <Text style={styles.hintText}>{guidance.hint}</Text>
          </View>
        ) : null}
        {cameraOn ? (
          <View style={styles.tools}>
            <Pressable accessibilityRole="button" accessibilityLabel={facing === 'back' ? 'Switch to front camera' : 'Switch to back camera'} onPress={flip} style={styles.toolButton}>
              <Ionicons name="camera-reverse-outline" size={20} color={colors.surface} />
            </Pressable>
            {torchSupported ? (
              <Pressable accessibilityRole="switch" accessibilityLabel="Torch" accessibilityState={{ checked: torch }} onPress={() => setTorch((on) => !on)} style={[styles.toolButton, torch && styles.toolButtonOn]}>
                <Ionicons name={torch ? 'flash' : 'flash-off-outline'} size={19} color={torch ? '#0B2735' : colors.surface} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {busy ? <View style={styles.busy}><ActivityIndicator color={colors.surface} /><Text style={styles.busyText}>AI checking frame…</Text></View> : null}
      </View>
      {duplicate ? <DuplicateFrameBanner notice={duplicate} /> : <QualityBanner analysis={feedback ?? null} />}
      {error ? <Text selectable accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.stack}>
        <Pressable accessibilityRole="button" accessibilityLabel={shutterLabel} accessibilityState={{ disabled: shutterDisabled }} disabled={shutterDisabled} onPress={shutter}>
          {({ pressed }) => (
            <View style={[styles.shutter, shutterDisabled && styles.shutterDisabled, pressed && !shutterDisabled && styles.shutterPressed]}>
              <View style={styles.shutterRing}>
                {requesting || (cameraOn && !ready) ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name={cameraOn ? 'camera' : blocked ? 'settings-outline' : 'videocam'} size={22} color={colors.primary} />}
              </View>
              <Text style={styles.shutterText}>{shutterLabel}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.orRow}><View style={styles.orLine} /><Text style={styles.orText}>OR</Text><View style={styles.orLine} /></View>
        <PrimaryButton label={uploadLabel} icon="folder-open-outline" variant="outline" onPress={() => void upload()} disabled={busy || disabled} />
      </View>
    </View>
  );
}

export interface DuplicateFrameNotice {
  /** 1-based frame number of the matched accepted frame. */
  frameNumber: number;
  angleName: string;
  similarity: number;
  identical: boolean;
}

/** DUPLICATE_FRAME rejection: the frame repeats an accepted one. Kept separate from image-quality failures. */
export function DuplicateFrameBanner({ notice }: { notice: DuplicateFrameNotice }) {
  return (
    <View accessibilityRole="alert" style={styles.dupBanner}>
      <View style={styles.dupIcon}><Ionicons name="copy-outline" size={18} color={colors.surface} /></View>
      <View style={styles.flex}>
        <Text style={styles.dupTitle}>DUPLICATE IMAGE DETECTED — CHANGE ANGLE</Text>
        <Text style={styles.dupText}>
          This image is identical or too similar to Frame #{notice.frameNumber} ({notice.angleName}). Bovine registration requires distinct angles (Front, Left ~15°, Right ~15°) to map the 3D muzzle ridge pattern. Please rotate 10°–15° or choose a different perspective.
        </Text>
        <Text selectable style={styles.dupMeta}>{notice.identical ? 'Identical image data' : `Cosine similarity ${notice.similarity.toFixed(4)} (limit 0.9995)`} · frame not added</Text>
      </View>
    </View>
  );
}

export function QualityBanner({ analysis }: { analysis: MuzzleAnalysis | null }) {
  if (!analysis) {
    return (
      <View style={[styles.banner, styles.bannerIdle]}>
        <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
        <View style={styles.flex}><Text style={[styles.bannerTitle, { color: colors.text }]}>AWAITING FRAME</Text><Text style={styles.bannerHint}>Each frame is checked by AI muzzle detection plus measured focus, lighting and glare.</Text></View>
      </View>
    );
  }
  const good = analysis.status === GOOD;
  const warn = WARN_STATUSES.includes(analysis.status);
  const color = good ? colors.primary : warn ? colors.warning : colors.danger;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: good ? colors.primaryLight : warn ? colors.warningLight : colors.dangerLight }]}>
      <Ionicons name={good ? 'checkmark-circle' : 'alert-circle'} size={18} color={color} />
      <View style={styles.flex}>
        <Text style={[styles.bannerTitle, { color }]}>{analysis.status}</Text>
        {good || analysis.reasons.length === 0 ? <Text style={styles.bannerHint}>{analysis.hint || QUALITY_HINTS[analysis.status]}</Text> : null}
        {!good ? analysis.reasons.map((reason) => (
          <Text key={reason} style={styles.bannerHint}>• {REASON_GUIDANCE[reason].cause} {REASON_GUIDANCE[reason].fix}</Text>
        )) : null}
        {analysis.metrics ? (
          <Text selectable style={styles.metrics}>
            Q {Math.round(analysis.qualityScore * 100)}% · focus {analysis.metrics.sharpness.toFixed(0)} · light {analysis.metrics.brightness.toFixed(0)} · contrast {analysis.metrics.contrast.toFixed(0)} · fill {Math.round(analysis.metrics.fill * 100)}% · {analysis.processingMs} ms
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const ANALYSIS_STAGES: PipelineStage[] = ['normalize', 'detect', 'crop', 'quality', 'embed', 'search'];

/** Real stage progress reported by the engine callbacks. */
export function EnginePipeline({ stage, includeSearch = true }: { stage: PipelineStage | null; includeSearch?: boolean }) {
  const stages = includeSearch ? ANALYSIS_STAGES : ANALYSIS_STAGES.slice(0, 5);
  const index = stage ? stages.indexOf(stage) : -1;
  return <PipelineList steps={stages.map((s) => STAGE_LABELS[s])} activeStep={index} />;
}

/** Private capture shown through a short-lived signed URL. */
export function CaptureImage({ path, uri, size = 120, label }: { path?: string | null; uri?: string | null; size?: number; label: string }) {
  const [signed, setSigned] = useState<{ path: string; url: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (uri || !path) return undefined;
    let active = true;
    signedCaptureUrl(path)
      .then((url) => { if (active) setSigned({ path, url, failed: false }); })
      .catch((caught: unknown) => {
        console.error('Signed capture URL failed', caught);
        if (active) setSigned({ path, url: null, failed: true });
      });
    return () => { active = false; };
  }, [path, uri]);
  const current = signed && signed.path === path ? signed : null;
  const url = uri ?? current?.url ?? null;
  const failed = !uri && !!current?.failed;
  return (
    <View style={[styles.capture, { width: size, height: size }]}>
      {url ? <Image source={{ uri: url }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel={label} /> : (
        <View style={styles.captureEmpty}>
          {path && !failed ? <ActivityIndicator color={colors.primary} /> : <Ionicons name={failed ? 'alert-circle-outline' : 'image-outline'} size={22} color={colors.muted} />}
          <Text style={styles.captureEmptyText}>{failed ? 'Unavailable' : path ? 'Loading' : 'No reference'}</Text>
        </View>
      )}
      <View style={styles.captureTag}><Text style={styles.captureTagText}>{label}</Text></View>
    </View>
  );
}

/** Similarity meter with the decision bands drawn at the live thresholds. */
export function ScoreMeter({ score, upper, lower, upperLabel = 'Match' }: { score: number; upper: number; lower: number; upperLabel?: string }) {
  const pct = Math.max(0, Math.min(1, score));
  const color = score >= upper ? colors.primary : score >= lower ? colors.warning : colors.danger;
  return (
    <View style={styles.meter}>
      <View style={styles.meterHead}><Text style={styles.meterLabel}>Cosine similarity</Text><Text selectable style={[styles.meterValue, { color }]}>{score.toFixed(3)}</Text></View>
      <View style={styles.track}>
        <View style={[styles.band, { left: 0, width: `${lower * 100}%`, backgroundColor: colors.dangerLight }]} />
        <View style={[styles.band, { left: `${lower * 100}%`, width: `${(upper - lower) * 100}%`, backgroundColor: colors.warningLight }]} />
        <View style={[styles.band, { left: `${upper * 100}%`, right: 0, backgroundColor: colors.primaryLight }]} />
        <View style={[styles.marker, { left: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <View style={styles.meterLegend}><Text style={styles.legend}>No match &lt; {lower.toFixed(2)}</Text><Text style={styles.legend}>Uncertain</Text><Text style={styles.legend}>{upperLabel} ≥ {upper.toFixed(2)}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { gap: 10 },
  viewfinder: { height: 340, borderRadius: 18, overflow: 'hidden', backgroundColor: '#0B2735', position: 'relative' },
  cameraOff: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, zIndex: 2 },
  cameraOffTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 15 },
  cameraOffText: { color: '#CFE3E8', fontFamily: Fonts.regular, fontSize: 12, textAlign: 'center' },
  ghostButton: { marginTop: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  ghostText: { color: colors.surface, fontFamily: Fonts.semiBold, fontSize: 13 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8 },
  oval: { width: 190, height: 150, borderRadius: 95, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.8)' },
  ovalGood: { borderColor: '#34D399', borderStyle: 'solid', borderWidth: 3 },
  ovalWarn: { borderColor: '#FBBF24', borderStyle: 'solid', borderWidth: 3 },
  ovalBad: { borderColor: '#F87171', borderStyle: 'solid', borderWidth: 3 },
  ovalLabelWarn: { color: '#FBBF24' },
  hud: { position: 'absolute', top: 12, left: 12, right: 64, alignItems: 'flex-start', zIndex: 3 },
  hudBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', backgroundColor: '#FBBF24', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  hudText: { flexShrink: 1, color: '#0B2735', fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  stack: { gap: 10 },
  dupBanner: { flexDirection: 'row', gap: 11, padding: 13, borderRadius: 14, alignItems: 'flex-start', backgroundColor: '#FFF7ED', borderWidth: 1.5, borderColor: '#F59E0B', borderLeftWidth: 5, borderLeftColor: colors.danger },
  dupIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  dupTitle: { color: '#B45309', fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.4, lineHeight: 18 },
  dupText: { color: colors.text, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 4 },
  dupMeta: { color: '#9A3412', fontFamily: Fonts.semiBold, fontSize: 11, marginTop: 6, fontVariant: ['tabular-nums'] },
  ovalLabel: { color: 'rgba(255,255,255,0.85)', fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 2 },
  tools: { position: 'absolute', top: 12, right: 12, gap: 8, zIndex: 3 },
  toolButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center' },
  toolButtonOn: { backgroundColor: '#FBBF24' },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 4 },
  busyText: { color: colors.surface, fontFamily: Fonts.semiBold, fontSize: 12, letterSpacing: 0.6 },
  cameraOffIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(184,233,204,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  nostrilRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  nostril: { width: 34, height: 24, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)', backgroundColor: 'rgba(255,255,255,0.08)' },
  nostrilLeft: { transform: [{ rotate: '-18deg' }] },
  nostrilRight: { transform: [{ rotate: '18deg' }] },
  bridge: { width: 2, height: 46, backgroundColor: 'rgba(255,255,255,0.35)' },
  arrow: { position: 'absolute', zIndex: 3 },
  arrowLeft: { left: 14, top: '45%' },
  arrowRight: { right: 14, top: '45%' },
  arrowUp: { top: 52, alignSelf: 'center' },
  hintBar: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(11,39,53,0.8)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, zIndex: 3 },
  hintText: { flex: 1, color: colors.surface, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16 },
  shutter: { minHeight: 60, borderRadius: 16, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingRight: 16, boxShadow: '0 6px 16px rgba(5,150,105,0.28)' },
  shutterDisabled: { opacity: 0.5 },
  shutterPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  shutterRing: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 3, borderColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  shutterText: { flex: 1, color: colors.surface, fontFamily: Fonts.bold, fontSize: 15, lineHeight: 20 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.5 },
  banner: { flexDirection: 'row', gap: 9, padding: 12, borderRadius: 12, alignItems: 'flex-start' },
  bannerIdle: { backgroundColor: colors.slateLight },
  bannerTitle: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.4 },
  bannerHint: { color: colors.text, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  metrics: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11, marginTop: 4, fontVariant: ['tabular-nums'] },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10 },
  capture: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.slateLight, position: 'relative' },
  captureEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  captureEmptyText: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 10 },
  captureTag: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  captureTagText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 9, letterSpacing: 0.5 },
  meter: { gap: 6 },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  meterLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12 },
  meterValue: { fontFamily: Fonts.bold, fontSize: 20, fontVariant: ['tabular-nums'] },
  track: { height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.slateLight, position: 'relative' },
  band: { position: 'absolute', top: 0, bottom: 0 },
  marker: { position: 'absolute', top: -2, bottom: -2, width: 4, marginLeft: -2, borderRadius: 2 },
  meterLegend: { flexDirection: 'row', justifyContent: 'space-between' },
  legend: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 10 },
});
