import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RequireAccess, TabShell } from '@/components/app-chrome';
import { CaptureImage, EnginePipeline, errorText, MuzzleCapture, ScoreMeter } from '@/components/biometric-ui';
import { AnimalPhoto, Card, colors, DataGate, formatMoozzleId, Pill, PrimaryButton, TextField, tr } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { analyzeMuzzle, identifyMuzzle, requestScanReview } from '@/lib/biometric/engine';
import { ENGINE_MODEL } from '@/lib/biometric/features';
import { allows, usesTechnicalLanguage } from '@/lib/rbac';
import { useAppStore } from '@/store/useAppStore';
import { logAudit, useBovineData, useSession } from '@/store/useBovineStore';
import { useCaptureHandoff } from '@/store/useCaptureHandoff';
import { useIsOnline } from '@/store/useConnectivity';
import type { Animal, IdentifyResult, MatchCandidate, MuzzleAnalysis, PipelineStage } from '@/store/types';

type Phase = 'capture' | 'analyzing' | 'searching' | 'result';
const MAX_FRAMES = 5;

export default function IdentifyScreen() {
  return (
    <DataGate>
      <RequireAccess destination="identify">
        <TabShell active="identify">
          <IdentifyContent />
        </TabShell>
      </RequireAccess>
    </DataGate>
  );
}

function IdentifyContent() {
  const session = useSession();
  const { animals } = useBovineData();
  const language = useAppStore((state) => state.language);
  const online = useIsOnline();
  const setHandoff = useCaptureHandoff((state) => state.setFrame);
  const technical = session.role ? usesTechnicalLanguage(session.role) : true;
  const canRegister = allows(session.permissions.register_animal);
  const [phase, setPhase] = useState<Phase>('capture');
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [feedback, setFeedback] = useState<MuzzleAnalysis | null>(null);
  const [frames, setFrames] = useState<MuzzleAnalysis[]>([]);
  const [addingMore, setAddingMore] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState('');
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [review, setReview] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [reviewError, setReviewError] = useState('');
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<Animal | null>(null);
  const [copied, setCopied] = useState(false);

  const lookupResults = useMemo(() => {
    const normalized = query.replace(/\s/g, '').toLowerCase();
    if (normalized.length < 3) return [];
    return animals.filter((item) => [item.moozzle_id, item.breed, item.farm_name.replace(/\s/g, ''), item.village.replace(/\s/g, '')].some((value) => value.toLowerCase().includes(normalized))).slice(0, 6);
  }, [animals, query]);

  const runSearch = useCallback(async (accepted: MuzzleAnalysis[]) => {
    setPhase('searching');
    try {
      const found = await identifyMuzzle(accepted, setStage);
      setResult(found);
      setReview('idle');
      setReviewError('');
      setPhase('result');
    } catch (caught) {
      console.error('1:N identification failed', caught);
      setError(errorText(caught, 'The biometric search could not complete. Check your connection and retry.'));
      setPhase('capture');
    } finally {
      setStage(null);
    }
  }, []);

  const handleFrame = useCallback(async (uri: string) => {
    setError('');
    setPendingUri(uri);
    setPhase('analyzing');
    try {
      const analysis = await analyzeMuzzle(uri, setStage);
      setFeedback(analysis);
      if (!analysis.embedding) {
        void logAudit('biometric.capture', '', `Frame rejected: ${analysis.status}`, 'failed');
        setPendingUri(null);
        setPhase('capture');
        return;
      }
      const accepted = addingMore ? [...frames, analysis].slice(0, MAX_FRAMES) : [analysis];
      setFrames(accepted);
      setAddingMore(false);
      setPendingUri(null);
      await runSearch(accepted);
    } catch (caught) {
      console.error('Muzzle analysis failed', caught);
      setError(errorText(caught, 'AI muzzle analysis failed. Check your connection and retry.'));
      setPhase('capture');
    } finally {
      setStage(null);
    }
  }, [addingMore, frames, runSearch]);

  const retry = useCallback(() => {
    if (pendingUri) void handleFrame(pendingUri);
    else if (frames.length) void runSearch(frames);
  }, [frames, handleFrame, pendingUri, runSearch]);

  const reset = useCallback(() => {
    setPhase('capture');
    setResult(null);
    setFrames([]);
    setFeedback(null);
    setAddingMore(false);
    setError('');
    setPendingUri(null);
    setLookup(null);
    setCopied(false);
  }, []);

  const captureMore = useCallback(() => {
    setAddingMore(true);
    setResult(null);
    setFeedback(null);
    setPhase('capture');
  }, []);

  const registerNew = useCallback(() => {
    setHandoff(frames[0] ?? null);
    router.push('/register');
  }, [frames, setHandoff]);

  const cancel = useCallback(() => {
    reset();
    router.replace('/(tabs)');
  }, [reset]);

  const sendReview = useCallback(async () => {
    if (!result) return;
    setReview('sending');
    setReviewError('');
    try {
      await requestScanReview(result.scan_id, `Uncertain 1:N scan, ${result.frames} frame(s), top ${result.top_score.toFixed(3)}`);
      setReview('sent');
    } catch (caught) {
      console.error('Manual review request failed', caught);
      setReviewError(errorText(caught, 'The review request could not be sent. Please retry.'));
      setReview('idle');
    }
  }, [result]);

  const copyId = useCallback(async (id: string) => {
    try {
      await Clipboard.setStringAsync(id);
      setCopied(true);
    } catch (caught) {
      console.error('Could not copy MOOZZLE ID', caught);
      setError('Copy is unavailable on this device. The ID remains selectable.');
    }
  }, []);

  const chooseLookup = useCallback((animal: Animal) => {
    setLookup(animal);
    setQuery('');
    void logAudit('record.view', animal.moozzle_id, 'Looked up by MOOZZLE ID / filter', 'success');
  }, []);

  const busy = phase === 'analyzing' || phase === 'searching';
  const probeUri = frames[0]?.cropUri ?? frames[0]?.imageUri ?? null;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{technical ? '1:N BIOMETRIC SEARCH' : 'FIND MY ANIMAL'}</Text>
          <Text style={styles.title}>{tr(language, 'identifyAnimal')}</Text>
        </View>
        <Pill label={online ? 'AI Engine: Connected' : 'Offline'} tone={online ? 'green' : 'amber'} />
      </View>
      <Text style={styles.subtitle}>{technical ? 'AI muzzle detection, measured quality checks and a 256-D texture embedding compared against every enrolled template.' : 'Take a clear photo of the nose of your animal.'}</Text>

      {!online ? (
        <View style={styles.warn}><Ionicons name="cloud-offline-outline" size={18} color={colors.warning} /><Text style={styles.warnText}>Offline: muzzle detection uses the AI Gateway and matching runs on the MOOZZLE server, so biometric scans need a connection. Use ID lookup on downloaded records.</Text></View>
      ) : null}

      {phase !== 'result' && online ? (
        <>
          {addingMore ? <View style={styles.info}><Ionicons name="layers-outline" size={18} color={colors.blue} /><Text style={styles.infoText}>Additional frame {frames.length + 1} of {MAX_FRAMES}. Frames are averaged in the search for a steadier score.</Text></View> : null}
          <MuzzleCapture onFrame={(uri) => void handleFrame(uri)} busy={busy} feedback={feedback} captureLabel={addingMore ? 'Capture Additional' : 'Capture & Identify'} />
          {busy ? <Card style={styles.processing}><Text style={styles.processingTitle}>{phase === 'analyzing' ? 'Analysing muzzle frame…' : 'Searching enrolled templates…'}</Text><EnginePipeline stage={stage} /></Card> : null}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text selectable style={styles.errorText}>{error}</Text>
              {pendingUri || frames.length ? <PrimaryButton label="Retry" icon="refresh-outline" variant="outline" onPress={retry} style={styles.retry} /> : null}
            </View>
          ) : null}
        </>
      ) : null}

      {phase === 'result' && result ? (
        <ResultView
          result={result}
          probeUri={probeUri}
          technical={technical}
          canRegister={canRegister}
          canAddFrames={frames.length < MAX_FRAMES}
          copied={copied}
          review={review}
          reviewError={reviewError}
          onCopy={copyId}
          onScanAgain={reset}
          onRegister={registerNew}
          onCancel={cancel}
          onCaptureMore={captureMore}
          onReview={() => void sendReview()}
        />
      ) : null}

      {phase === 'capture' && !addingMore ? (
        <Card style={styles.lookup}>
          <TextField label="Look up by MOOZZLE ID, breed, farm or village" value={query} onChangeText={setQuery} placeholder="e.g. 4827 or Gir" autoCapitalize="none" />
          {query.replace(/\s/g, '').length >= 3 && lookupResults.length === 0 ? <Text style={styles.lookupEmpty}>No animal in your authorised records matches “{query.trim()}”.</Text> : null}
          {lookupResults.map((animal) => (
            <Pressable key={animal.id} accessibilityRole="button" onPress={() => chooseLookup(animal)} style={({ pressed }) => [styles.lookupRow, pressed && styles.pressed]}>
              <AnimalPhoto animal={animal} size={42} />
              <View style={styles.flex}><Text selectable style={styles.lookupId}>{formatMoozzleId(animal.moozzle_id)}</Text><Text style={styles.lookupMeta}>{animal.breed} · {animal.farm_name || animal.village}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
          {lookup ? (
            <View style={styles.lookupResult}>
              <Text style={styles.kicker}>RECORD FOUND BY ID LOOKUP (NOT A BIOMETRIC MATCH)</Text>
              <Text selectable style={styles.lookupBig}>{formatMoozzleId(lookup.moozzle_id)}</Text>
              <PrimaryButton label="View Animal Record" icon="document-text-outline" onPress={() => router.push(`/animal/${lookup.moozzle_id}`)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.disclaimer}><Ionicons name="information-circle-outline" size={18} color={colors.blue} /><Text style={styles.disclaimerText}>Engine {ENGINE_MODEL}: AI Gateway vision for muzzle detection, on-device focus/lighting/glare measurement, HOG texture embedding (256-D) and pgvector cosine search. Thresholds are uncalibrated until field validation reaches the benchmark on the Model Performance screen. Every scan is written to the audit trail.</Text></View>
    </ScrollView>
  );
}

interface ResultProps {
  result: IdentifyResult;
  probeUri: string | null;
  technical: boolean;
  canRegister: boolean;
  canAddFrames: boolean;
  copied: boolean;
  review: 'idle' | 'sending' | 'sent';
  reviewError: string;
  onCopy: (id: string) => void;
  onScanAgain: () => void;
  onRegister: () => void;
  onCancel: () => void;
  onCaptureMore: () => void;
  onReview: () => void;
}

function ResultView(props: ResultProps) {
  const { result } = props;
  const top = result.candidates[0];
  if (result.outcome === 'match' && top) {
    return (
      <View style={styles.resultStack}>
        <View style={[styles.banner, { backgroundColor: colors.primary }]}>
          <View style={styles.bannerIcon}><Ionicons name="checkmark" size={22} color={colors.surface} /></View>
          <View style={styles.flex}><Text style={styles.bannerTitle}>ANIMAL IDENTIFIED</Text><Text style={styles.bannerSubtitle}>Confirmed Match · {result.frames} frame(s) · {result.templates_searched} templates searched</Text></View>
        </View>
        <Card style={styles.resultCard}>
          <View style={styles.idHeader}>
            <View style={styles.flex}><Text style={styles.kicker}>MOOZZLE ID</Text><Text selectable style={styles.resultId}>{top.in_scope ? formatMoozzleId(top.moozzle_id) : top.moozzle_id}</Text></View>
            {top.in_scope ? <Pressable accessibilityRole="button" accessibilityLabel="Copy MOOZZLE ID" onPress={() => props.onCopy(top.moozzle_id)} style={styles.copy}><Ionicons name={props.copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.primary} /><Text style={styles.copyText}>{props.copied ? 'Copied' : 'Copy'}</Text></Pressable> : null}
          </View>
          <Text style={styles.summaryText}>{top.in_scope ? `${capital(top.species)} · ${top.breed} · ${capital(top.sex ?? '')} · ${top.age_years} yrs · ${top.farm_name || top.village}` : `${capital(top.species)} · registered outside your authorised scope. Details are withheld; contact the owning organisation.`}</Text>
          <View style={styles.compare}>
            <CaptureImage uri={props.probeUri} label="THIS SCAN" size={132} />
            <Ionicons name="swap-horizontal" size={20} color={colors.muted} />
            <CaptureImage path={top.in_scope ? top.reference_image_path : null} label="REFERENCE" size={132} />
          </View>
          <ScoreMeter score={top.score} upper={result.match_threshold} lower={result.review_threshold} />
        </Card>
        {top.in_scope ? <PrimaryButton label="VIEW ANIMAL RECORD" icon="document-text-outline" onPress={() => router.push(`/animal/${top.moozzle_id}`)} /> : null}
        <PrimaryButton label="SCAN NEXT ANIMAL" icon="scan-outline" variant="outline" onPress={props.onScanAgain} />
      </View>
    );
  }
  if (result.outcome === 'uncertain') {
    return (
      <View style={styles.resultStack}>
        <View style={[styles.banner, { backgroundColor: colors.warning }]}>
          <View style={[styles.bannerIcon, { backgroundColor: '#B45309' }]}><Ionicons name="help" size={22} color={colors.surface} /></View>
          <View style={styles.flex}><Text style={styles.bannerTitle}>IDENTIFICATION UNCERTAIN</Text><Text style={styles.bannerSubtitle}>Possible match between {result.review_threshold.toFixed(2)} and {result.match_threshold.toFixed(2)} · no ID is confirmed</Text></View>
        </View>
        <Card style={styles.resultCard}>
          <Text style={styles.kicker}>LEADING CANDIDATES</Text>
          {result.candidates.map((candidate, index) => <CandidateRow key={`${candidate.moozzle_id}-${candidate.score}`} candidate={candidate} rank={index + 1} />)}
          <ScoreMeter score={result.top_score} upper={result.match_threshold} lower={result.review_threshold} />
        </Card>
        <View style={styles.buttonRow}>
          <PrimaryButton label="RETAKE IMAGE" icon="refresh-outline" variant="outline" onPress={props.onScanAgain} style={styles.half} />
          <PrimaryButton label="CAPTURE ADDITIONAL IMAGES" icon="layers-outline" variant="blue" onPress={props.onCaptureMore} disabled={!props.canAddFrames} style={styles.half} />
        </View>
        <PrimaryButton label={props.review === 'sent' ? 'MANUAL REVIEW REQUESTED' : props.review === 'sending' ? 'SENDING…' : 'REQUEST MANUAL REVIEW'} icon="people-outline" variant="soft" onPress={props.onReview} disabled={props.review !== 'idle'} />
        {props.review === 'sent' ? <Text style={styles.okText}>Reviewers responsible for the candidate animals have been notified. The request is in the audit trail.</Text> : null}
        {props.reviewError ? <Text selectable style={styles.errorText}>{props.reviewError}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.resultStack}>
      <Card style={styles.noMatch}>
        <View style={styles.noMatchIcon}><Ionicons name="search-outline" size={28} color={colors.danger} /></View>
        <Text style={styles.noMatchTitle}>NO REGISTERED MATCH FOUND</Text>
        <Text style={styles.noMatchText}>{props.technical ? `Best similarity ${result.top_score.toFixed(3)} is below ${result.review_threshold.toFixed(2)} across ${result.templates_searched} enrolled templates. This animal appears to be new.` : 'This animal is not registered yet.'}</Text>
        <CaptureImage uri={props.probeUri} label="THIS SCAN" size={120} />
      </Card>
      <PrimaryButton label="SCAN AGAIN" icon="refresh-outline" variant="outline" onPress={props.onScanAgain} />
      {props.canRegister ? <PrimaryButton label="REGISTER NEW ANIMAL" icon="add-circle-outline" onPress={props.onRegister} /> : <Text style={styles.subtitle}>Your role cannot register animals. Ask an authorised field worker to enrol it.</Text>}
      <PrimaryButton label="CANCEL" variant="soft" onPress={props.onCancel} />
    </View>
  );
}

function CandidateRow({ candidate, rank }: { candidate: MatchCandidate; rank: number }) {
  const body = (
    <View style={styles.candidate}>
      <Text style={styles.rank}>#{rank}</Text>
      <CaptureImage path={candidate.in_scope ? candidate.reference_image_path : null} label="REF" size={52} />
      <View style={styles.flex}>
        <Text selectable style={styles.lookupId}>{candidate.in_scope ? formatMoozzleId(candidate.moozzle_id) : candidate.moozzle_id}</Text>
        <Text style={styles.lookupMeta}>{candidate.in_scope ? `${candidate.breed} ${capital(candidate.species)} · ${candidate.farm_name || candidate.village}` : `${capital(candidate.species)} · outside your scope`}</Text>
      </View>
      <Text selectable style={styles.score}>{candidate.score.toFixed(3)}</Text>
    </View>
  );
  if (!candidate.in_scope) return body;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open candidate ${candidate.moozzle_id}`} onPress={() => router.push(`/animal/${candidate.moozzle_id}`)}>{({ pressed }) => <View style={pressed ? styles.pressed : undefined}>{body}</View>}</Pressable>;
}

function capital(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32, maxWidth: 760, width: '100%', alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyebrow: { color: colors.blue, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.1 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 26 },
  subtitle: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  warn: { flexDirection: 'row', gap: 8, backgroundColor: colors.warningLight, borderRadius: 12, padding: 12 },
  warnText: { flex: 1, color: '#92400E', fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  info: { flexDirection: 'row', gap: 8, backgroundColor: colors.blueLight, borderRadius: 12, padding: 12 },
  infoText: { flex: 1, color: '#075985', fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  processing: { gap: 14 },
  processingTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  errorBox: { gap: 8, backgroundColor: colors.dangerLight, borderRadius: 12, padding: 12 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  okText: { color: colors.primary, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  retry: { alignSelf: 'flex-start', minHeight: 44 },
  resultStack: { gap: 12 },
  banner: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 15, letterSpacing: 0.4 },
  bannerSubtitle: { color: '#F0FDF4', fontFamily: Fonts.medium, fontSize: 12, marginTop: 2 },
  resultCard: { gap: 12 },
  idHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  resultId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 26, letterSpacing: 1, fontVariant: ['tabular-nums'], marginTop: 3 },
  copy: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 12 },
  copyText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 12 },
  summaryText: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14, lineHeight: 20 },
  compare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minHeight: 54, paddingHorizontal: 8 },
  noMatch: { alignItems: 'center', gap: 10 },
  noMatchIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  noMatchTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, textAlign: 'center', letterSpacing: 0.4 },
  noMatchText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  candidate: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56 },
  rank: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, width: 22 },
  score: { color: colors.warning, fontFamily: Fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  lookup: { gap: 10 },
  lookupEmpty: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  lookupRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  lookupId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  lookupMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  lookupResult: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  lookupBig: { color: colors.text, fontFamily: Fonts.bold, fontSize: 22, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.8 },
  disclaimer: { flexDirection: 'row', gap: 7, backgroundColor: colors.blueLight, padding: 11, borderRadius: 10 },
  disclaimerText: { color: '#075985', flex: 1, fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16 },
});
