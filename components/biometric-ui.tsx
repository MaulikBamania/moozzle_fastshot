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

/** Live camera viewfinder with muzzle guide, flip toggle, capture trigger and photo-upload fallback. */
export function MuzzleCapture({
  onFrame,
  busy,
  captureLabel = 'Capture & Identify',
  disabled = false,
  feedback,
}: {
  onFrame: (uri: string, source: CaptureSource) => void;
  busy: boolean;
  captureLabel?: string;
  disabled?: boolean;
  feedback?: MuzzleAnalysis | null;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [mountFailed, setMountFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const cameraRef = useRef<CameraView>(null);
  // The camera runs only once permission is granted; a mount failure falls back to photo upload.
  const cameraOn = !!permission?.granted && !mountFailed;

  const startCamera = useCallback(async () => {
    setError('');
    setMountFailed(false);
    try {
      const result = await requestPermission();
      if (!result.granted) setError(result.canAskAgain ? 'Camera access was declined. Allow it to scan, or upload a muzzle photo instead.' : 'Camera access is blocked for this app. Enable it in Settings, or upload a muzzle photo.');
    } catch (caught) {
      console.error('Camera permission request failed', caught);
      setError('This device has no available camera. Upload a muzzle photo instead.');
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

  const status = feedback?.status;
  const tone = !status ? 'idle' : status === GOOD ? 'good' : WARN_STATUSES.includes(status) ? 'warn' : 'bad';

  return (
    <View style={styles.wrap}>
      <View style={styles.viewfinder}>
        {cameraOn ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
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
            <Ionicons name="camera-outline" size={34} color="#B8E9CC" />
            <Text style={styles.cameraOffTitle}>Live muzzle camera</Text>
            <Text style={styles.cameraOffText}>{permission && !permission.granted && !permission.canAskAgain ? 'Camera permission is blocked.' : 'Start the camera, or upload a field photo.'}</Text>
            {permission && !permission.granted && !permission.canAskAgain && process.env.EXPO_OS !== 'web' ? (
              <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.ghostButton}><Text style={styles.ghostText}>Open Settings</Text></Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => void startCamera()} style={styles.ghostButton}><Ionicons name="videocam-outline" size={16} color={colors.surface} /><Text style={styles.ghostText}>Start Camera</Text></Pressable>
            )}
          </View>
        )}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={[styles.oval, tone === 'good' && styles.ovalGood, tone === 'warn' && styles.ovalWarn, tone === 'bad' && styles.ovalBad]} />
          <Text style={styles.ovalLabel}>ALIGN MUZZLE</Text>
        </View>
        {cameraOn ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} style={styles.flip}>
            <Ionicons name="camera-reverse-outline" size={20} color={colors.surface} />
          </Pressable>
        ) : null}
        {busy ? <View style={styles.busy}><ActivityIndicator color={colors.surface} /></View> : null}
      </View>
      <QualityBanner analysis={feedback ?? null} />
      {error ? <Text selectable accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <PrimaryButton label="Upload Muzzle Photo" icon="image-outline" variant="outline" onPress={() => void upload()} disabled={busy || disabled} style={styles.flex} />
        {cameraOn ? <PrimaryButton label={captureLabel} icon="scan-outline" onPress={() => void capture()} disabled={busy || disabled || !ready} style={styles.flex} /> : null}
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
  viewfinder: { height: 300, borderRadius: 18, overflow: 'hidden', backgroundColor: '#0B2735', position: 'relative' },
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
  ovalLabel: { color: 'rgba(255,255,255,0.85)', fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 2 },
  flip: { position: 'absolute', top: 12, right: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 4 },
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
