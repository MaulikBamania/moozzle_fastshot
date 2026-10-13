import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { RequireAccess, TabShell } from '@/components/app-chrome';
import { ConfigFootnote, DecisionBanner, PendingScansCard, QualityInsufficientPanel, ServiceUnavailablePanel, TestSessionBanner } from '@/components/biometric-decision';
import { CaptureImage, EnginePipeline, errorText, MuzzleCapture, ScoreMeter } from '@/components/biometric-ui';
import { AnimalPhoto, Card, colors, DataGate, formatMoozzleId, Pill, PrimaryButton, TextField, tr } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { decisionForOutcome, reasonText } from '@/lib/biometric/decision';
import { analyzeMuzzle, identifyMuzzle, logAcquisitionEvent, requestScanReview } from '@/lib/biometric/engine';
import { classifyBiometricError } from '@/lib/biometric/errors';
import { ENGINE_MODEL } from '@/lib/biometric/features';
import { formatAgeShort } from '@/lib/age';
import { allows, usesTechnicalLanguage } from '@/lib/rbac';
import { useAppStore } from '@/store/useAppStore';
import { logAudit, useBovineData, useSession } from '@/store/useBovineStore';
import { useCaptureHandoff } from '@/store/useCaptureHandoff';
import { isOnlineNow, useIsOnline } from '@/store/useConnectivity';
import { type PendingScan, usePendingScans } from '@/store/usePendingScans';
import type { Animal, CaptureSource, IdentifyResult, MatchCandidate, MuzzleAnalysis, PipelineStage } from '@/store/types';

/** capture → analyzing → (quality | searching → result | service) */
type Phase = 'capture' | 'analyzing' | 'searching' | 'result' | 'quality' | 'service';

interface ServiceState {
  message: string;
  capture: { uri: string; source: CaptureSource } | null;
}
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
  const addPending = usePendingScans((state) => state.add);
  const removePending = usePendingScans((state) => state.remove);
  const technical = session.role ? usesTechnicalLanguage(session.role) : true;
  const canRegister = allows(session.permissions.register_animal);
  const [phase, setPhase] = useState<Phase>('capture');
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [feedback, setFeedback] = useState<MuzzleAnalysis | null>(null);
  const [frames, setFrames] = useState<MuzzleAnalysis[]>([]);
  const [addingMore, setAddingMore] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState('');
  const [service, setService] = useState<ServiceState | null>(null);
  const [queued, setQueued] = useState(false);
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

  const toService = useCallback((caught: unknown, capture: { uri: string; source: CaptureSource } | null) => {
    const message = errorText(caught, 'The biometric service is unavailable.');
    setService({ message, capture });
    setQueued(false);
    setPhase('service');
    void logAcquisitionEvent({ operation: 'identify', eventType: 'service_unavailable', reasonCode: 'service_unavailable', source: capture?.source });
  }, []);

  const sendReview = useCallback(async (found: IdentifyResult) => {
    setReview('sending');
    setReviewError('');
    try {
      await requestScanReview(found.scan_id, `Possible 1:N match · ${found.frames} frame(s) · top ${found.top_score.toFixed(3)} · ${found.decision_reason}`);
      setReview('sent');
    } catch (caught) {
      console.error('Manual review request failed', caught);
      setReviewError(errorText(caught, 'The review request could not be sent. Please retry.'));
      setReview('idle');
    }
  }, []);

  const runSearch = useCallback(async (accepted: MuzzleAnalysis[], capture: { uri: string; source: CaptureSource } | null) => {
    setPhase('searching');
    try {
      const found = await identifyMuzzle(accepted, setStage);
      setResult(found);
      setReview('idle');
      setReviewError('');
      setPhase('result');
      // REVIEW REQUIRED goes to the authorised reviewers' queue automatically; no identity is claimed meanwhile.
      if (found.outcome === 'uncertain') void sendReview(found);
    } catch (caught) {
      console.error('1:N identification failed', caught);
      const kind = classifyBiometricError(caught);
      if (kind === 'service_unavailable') {
        toService(caught, capture);
      } else if (kind === 'quality') {
        setPhase('quality');
      } else {
        setError(errorText(caught, 'The biometric search could not complete. Please retry.'));
        setPhase('capture');
      }
    } finally {
      setStage(null);
    }
  }, [sendReview, toService]);

  const handleFrame = useCallback(async (uri: string, source: CaptureSource) => {
    setError('');
    setService(null);
    if (!isOnlineNow()) {
      toService(new Error('You are offline. Muzzle detection and matching run on the MOOZZLE service, so this capture cannot be compared yet.'), { uri, source });
      return;
    }
    setPhase('analyzing');
    try {
      const analysis = await analyzeMuzzle(uri, setStage, source);
      setFeedback(analysis);
      if (!analysis.embedding) {
        void logAcquisitionEvent({ operation: 'identify', eventType: 'failure_to_acquire', analysis, framesAccepted: frames.length });
        void logAudit('biometric.capture', '', `Frame rejected (not compared): ${analysis.status}`, 'failed');
        setPhase('quality');
        return;
      }
      const accepted = addingMore ? [...frames, analysis].slice(0, MAX_FRAMES) : [analysis];
      setFrames(accepted);
      setAddingMore(false);
      await runSearch(accepted, { uri, source });
    } catch (caught) {
      console.error('Muzzle analysis failed', caught);
      if (classifyBiometricError(caught) === 'service_unavailable') {
        toService(caught, { uri, source });
      } else {
        setError(errorText(caught, 'AI muzzle analysis failed. Please retry.'));
        setPhase('capture');
      }
    } finally {
      setStage(null);
    }
  }, [addingMore, frames, runSearch, toService]);

  const retryService = useCallback(() => {
    if (service?.capture) void handleFrame(service.capture.uri, service.capture.source);
    else if (frames.length) void runSearch(frames, null);
  }, [frames, handleFrame, runSearch, service]);

  const queueService = useCallback(() => {
    if (!service?.capture) return;
    addPending({ operation: 'identify', uri: service.capture.uri, source: service.capture.source, lastError: service.message });
    setQueued(true);
  }, [addPending, service]);

  const processPending = useCallback((item: PendingScan) => {
    removePending(item.id);
    setAddingMore(false);
    setFrames([]);
    void handleFrame(item.uri, item.source);
  }, [handleFrame, removePending]);

  const reset = useCallback(() => {
    setPhase('capture');
    setResult(null);
    setFrames([]);
    setFeedback(null);
    setAddingMore(false);
    setError('');
    setService(null);
    setLookup(null);
    setCopied(false);
  }, []);

  const recapture = useCallback(() => {
    setFeedback(null);
    setService(null);
    setPhase('capture');
  }, []);

  const captureMore = useCallback(() => {
    setAddingMore(true);
    setResult(null);
    setFeedback(null);
    setPhase('capture');
  }, []);

  const registerNew = useCallback(() => {
    // Authorised enrolment only after NO ACCEPTED MATCH; the server repeats the duplicate search before any ID is issued.
    setHandoff(frames[0] ?? null);
    router.push('/register');
  }, [frames, setHandoff]);

  const cancel = useCallback(() => {
    reset();
    router.replace('/(tabs)');
  }, [reset]);

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
  const showCapture = phase === 'capture' || busy;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{technical ? '1:N BIOMETRIC IDENTIFICATION' : 'FIND MY ANIMAL'}</Text>
          <Text style={styles.title}>{tr(language, 'identifyAnimal')}</Text>
        </View>
        <Pill label={online ? 'AI Engine: Connected' : 'Offline'} tone={online ? 'green' : 'amber'} />
      </View>
      <Text style={styles.subtitle}>{technical ? 'Searches the whole enrolled gallery. The identity is returned only when the approved 1:N acceptance rules are met; anything less goes to review or is reported as no accepted match.' : 'Take a clear photo of the nose of your animal.'}</Text>
      <TestSessionBanner />

      {!online && showCapture ? (
        <View style={styles.warn}><Ionicons name="cloud-offline-outline" size={18} color={colors.warning} /><Text style={styles.warnText}>Offline: biometric comparison needs the MOOZZLE service. Captures can be held in the pending queue; ID lookup still works on downloaded records.</Text></View>
      ) : null}

      <PendingScansCard operation="identify" online={online} busy={busy} onProcess={processPending} />

      {showCapture ? (
        <>
          {addingMore ? <View style={styles.info}><Ionicons name="layers-outline" size={18} color={colors.blue} /><Text style={styles.infoText}>Additional frame {frames.length + 1} of {MAX_FRAMES}. Frames are averaged in the search for a steadier score.</Text></View> : null}
          <MuzzleCapture onFrame={(uri, source) => void handleFrame(uri, source)} busy={busy} feedback={feedback} captureLabel={!online ? 'Capture for Pending' : addingMore ? 'Capture Additional' : 'Capture & Identify'} />
          {busy ? <Card style={styles.processing}><Text style={styles.processingTitle}>{phase === 'analyzing' ? 'Quality pre-check and muzzle analysis…' : 'Searching the enrolled gallery (1:N)…'}</Text><EnginePipeline stage={stage} /></Card> : null}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text selectable style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {phase === 'quality' && feedback ? <QualityInsufficientPanel analysis={feedback} onRecapture={recapture} /> : null}

      {phase === 'service' && service ? (
        <ServiceUnavailablePanel message={service.message} onRetry={online ? retryService : undefined} onQueue={service.capture ? queueService : undefined} queued={queued} />
      ) : null}
      {phase === 'service' ? <PrimaryButton label="BACK TO CAPTURE" icon="camera-outline" variant="outline" onPress={recapture} /> : null}

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
          onReview={() => void sendReview(result)}
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

      <View style={styles.disclaimer}><Ionicons name="information-circle-outline" size={18} color={colors.blue} /><Text style={styles.disclaimerText}>Engine {ENGINE_MODEL}. Thresholds come from the approved production configuration and cannot be changed in the field. They are pre-validation values: no accuracy claim is made until labelled 1:N testing at the intended gallery size is complete. Every scan, its configuration version and outcome are written to the audit trail.</Text></View>
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
  const decision = decisionForOutcome(result.outcome);
  const footnote = <ConfigFootnote configVersion={result.config_version} modelVersion={result.model_version} dataSource={result.data_source} extra={`gallery N = ${result.gallery_size} animals`} />;
  if (decision === 'MATCH_CONFIRMED' && top) {
    return (
      <View style={styles.resultStack}>
        <DecisionBanner decision="MATCH_CONFIRMED" subtitle={`${result.frames} frame(s) · ${result.templates_searched} templates searched · ${reasonText(result.decision_reason)}`} />
        <Card style={styles.resultCard}>
          <View style={styles.idHeader}>
            <View style={styles.flex}><Text style={styles.kicker}>MOOZZLE ID</Text><Text selectable style={styles.resultId}>{top.in_scope ? formatMoozzleId(top.moozzle_id) : top.moozzle_id}</Text></View>
            {top.in_scope ? <Pressable accessibilityRole="button" accessibilityLabel="Copy MOOZZLE ID" onPress={() => props.onCopy(top.moozzle_id)} style={styles.copy}><Ionicons name={props.copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.primary} /><Text style={styles.copyText}>{props.copied ? 'Copied' : 'Copy'}</Text></Pressable> : null}
          </View>
          <View style={styles.badge}><Ionicons name="shield-checkmark" size={16} color={colors.primary} /><Text style={styles.badgeText}>Biometric identity verified · 1:N config v{result.config_version}</Text></View>
          <Text style={styles.summaryText}>{top.in_scope ? `${capital(top.species)} · ${top.breed} · ${capital(top.sex ?? '')} · ${formatAgeShort(top.age_years, top.age_months)} · ${top.farm_name || top.village}` : `${capital(top.species)} · registered outside your authorised scope. Details are withheld; contact the owning organisation.`}</Text>
          <View style={styles.compare}>
            <CaptureImage uri={props.probeUri} label="THIS SCAN" size={132} />
            <Ionicons name="swap-horizontal" size={20} color={colors.muted} />
            <CaptureImage path={top.in_scope ? top.reference_image_path : null} label="REFERENCE" size={132} />
          </View>
          <ScoreMeter score={top.score} upper={result.match_threshold} lower={result.review_threshold} upperLabel="Confirmed" />
          {footnote}
        </Card>
        {top.in_scope ? <PrimaryButton label="VIEW ANIMAL RECORD" icon="document-text-outline" onPress={() => router.push(`/animal/${top.moozzle_id}`)} /> : null}
        <PrimaryButton label="SCAN NEXT ANIMAL" icon="scan-outline" variant="outline" onPress={props.onScanAgain} />
      </View>
    );
  }
  if (decision === 'REVIEW_REQUIRED') {
    return (
      <View style={styles.resultStack}>
        <DecisionBanner decision="REVIEW_REQUIRED" subtitle={`${reasonText(result.decision_reason)} No identity is confirmed.`} />
        <Card style={styles.resultCard}>
          <Text style={styles.kicker}>SIDE-BY-SIDE · LEADING CANDIDATE</Text>
          <View style={styles.compare}>
            <CaptureImage uri={props.probeUri} label="THIS SCAN" size={132} />
            <Ionicons name="git-compare-outline" size={20} color={colors.muted} />
            <CaptureImage path={top?.in_scope ? top.reference_image_path : null} label="CANDIDATE" size={132} />
          </View>
          <ScoreMeter score={result.top_score} upper={result.match_threshold} lower={result.review_threshold} upperLabel="Confirmed" />
          <Text style={styles.kicker}>CANDIDATE LIST (TOP {result.candidate_list_k}) — NOT CONFIRMED</Text>
          {result.candidates.map((candidate, index) => <CandidateRow key={`${candidate.moozzle_id}-${candidate.score}`} candidate={candidate} rank={index + 1} />)}
          {footnote}
        </Card>
        <View style={[styles.reviewBox, props.review === 'sent' && styles.reviewBoxSent]}>
          <Ionicons name={props.review === 'sent' ? 'checkmark-circle' : 'people-outline'} size={18} color={props.review === 'sent' ? colors.primary : colors.warning} />
          <Text style={styles.reviewText}>{props.review === 'sent' ? 'Sent to the review queue. Authorised reviewers for the candidate animals compare the muzzles and record the decision; you will be notified.' : props.review === 'sending' ? 'Sending to the review queue…' : 'Not yet in the review queue.'}</Text>
        </View>
        {props.reviewError ? <Text selectable style={styles.errorText}>{props.reviewError}</Text> : null}
        {props.review === 'idle' ? <PrimaryButton label="SEND TO REVIEW QUEUE" icon="people-outline" variant="soft" onPress={props.onReview} /> : null}
        <View style={styles.buttonRow}>
          <PrimaryButton label="RECAPTURE" icon="refresh-outline" variant="outline" onPress={props.onScanAgain} style={styles.half} />
          <PrimaryButton label="ADD FRAMES" icon="layers-outline" variant="blue" onPress={props.onCaptureMore} disabled={!props.canAddFrames} style={styles.half} />
        </View>
        <Text style={styles.subtitle}>Registering this animal as new is disabled while a possible match is unresolved.</Text>
      </View>
    );
  }
  return (
    <View style={styles.resultStack}>
      <DecisionBanner decision="NO_ACCEPTED_MATCH" />
      <Card style={styles.noMatch}>
        <Text style={styles.noMatchText}>{props.technical ? `Best similarity ${result.top_score.toFixed(3)} is below the 1:N review threshold ${result.review_threshold.toFixed(2)} across ${result.gallery_size} enrolled animals (${result.templates_searched} templates). No identity is claimed.` : 'No registered animal was matched. No identity is claimed.'}</Text>
        <CaptureImage uri={props.probeUri} label="THIS SCAN" size={120} />
        {footnote}
      </Card>
      <View style={styles.buttonRow}>
        <PrimaryButton label="RECAPTURE" icon="refresh-outline" variant="outline" onPress={props.onScanAgain} style={styles.half} />
        <PrimaryButton label="ADD FRAMES" icon="layers-outline" variant="blue" onPress={props.onCaptureMore} disabled={!props.canAddFrames} style={styles.half} />
      </View>
      {props.canRegister ? <PrimaryButton label="START AUTHORISED ENROLMENT" icon="add-circle-outline" onPress={props.onRegister} /> : <Text style={styles.subtitle}>Your role cannot enrol animals. Ask an authorised field worker to enrol it.</Text>}
      {props.canRegister ? <Text style={styles.subtitle}>Enrolment repeats the duplicate search on the server; a possible duplicate is held for review before any MOOZZLE ID is issued.</Text> : null}
      <PrimaryButton label="CANCEL" variant="soft" onPress={props.onCancel} />
    </View>
  );
}

/** Unconfirmed candidate: shown for context only, never a link to claim the identity. */
function CandidateRow({ candidate, rank }: { candidate: MatchCandidate; rank: number }) {
  return (
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
  resultStack: { gap: 12 },
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
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 12 },
  reviewBox: { flexDirection: 'row', gap: 8, backgroundColor: colors.warningLight, borderRadius: 12, padding: 12 },
  reviewBoxSent: { backgroundColor: colors.primaryLight },
  reviewText: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
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
