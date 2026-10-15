import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { StackScreen } from '@/components/app-chrome';
import { ConfigFootnote, DecisionBanner, PendingScansCard, QualityInsufficientPanel, ServiceUnavailablePanel, TestSessionBanner } from '@/components/biometric-decision';
import { CaptureImage, EnginePipeline, errorText, MuzzleCapture, ScoreMeter } from '@/components/biometric-ui';
import { Card, colors, DataGate, formatMoozzleId, OptionChip, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { TagIdentityCard } from '@/components/tag-identity-card';
import { tagLabel } from '@/lib/tag-id';
import { decisionForOutcome, reasonText } from '@/lib/biometric/decision';
import { analyzeMuzzle, logAcquisitionEvent, requestScanReview, verifyMuzzle } from '@/lib/biometric/engine';
import { classifyBiometricError } from '@/lib/biometric/errors';
import { isOnlineNow, useIsOnline } from '@/store/useConnectivity';
import { type PendingScan, usePendingScans } from '@/store/usePendingScans';
import { logAudit, recordVerification, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';
import type { CaptureSource, MuzzleAnalysis, PipelineStage, VerifyResult } from '@/store/types';

type PolicyOutcome = 'Verified' | 'Mismatch' | 'Manual Review' | 'Exception';

const OUTCOME_TEXT = {
  match: 'The scanned muzzle meets the approved 1:1 acceptance threshold for the claimed MOOZZLE ID.',
  uncertain: 'The claim is neither accepted nor rejected. An authorised reviewer must compare the muzzles.',
  no_match: 'The claimed identity is not accepted. Do not treat this animal as the claimed MOOZZLE ID.',
};

export default function VerifyScreen() {
  return (
    <DataGate>
      <StackScreen title="Verify Animal" eyebrow="1:1 biometric verification" destination="verify">
        <VerifyContent />
      </StackScreen>
    </DataGate>
  );
}

function VerifyContent() {
  const params = useLocalSearchParams<{ policy?: string; id?: string }>();
  const session = useSession();
  const policies = useBovineStore((state) => state.policyRows);
  const { animals } = useBovineData();
  const initialPolicy = policies.find((item) => item.id === params.policy) ?? null;
  const [policyId, setPolicyId] = useState<string | null>(initialPolicy?.id ?? null);
  const initialId = params.id ?? animals.find((item) => item.id === initialPolicy?.animal_id)?.moozzle_id ?? '';
  const [claimed, setClaimed] = useState(formatMoozzleId(initialId));
  const online = useIsOnline();
  const addPending = usePendingScans((state) => state.add);
  const removePending = usePendingScans((state) => state.remove);
  const [feedback, setFeedback] = useState<MuzzleAnalysis | null>(null);
  const [probe, setProbe] = useState<MuzzleAnalysis | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState<MuzzleAnalysis | null>(null);
  const [service, setService] = useState<{ message: string; uri: string; source: CaptureSource; claimed: string } | null>(null);
  const [queued, setQueued] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [review, setReview] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [reviewError, setReviewError] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  const digits = claimed.replace(/\D/g, '');
  const validId = digits.length === 12;
  const policy = policies.find((item) => item.id === policyId) ?? null;
  const claimedAnimal = useMemo(() => animals.find((item) => item.moozzle_id === digits), [animals, digits]);

  const clearOutcome = useCallback(() => {
    setResult(null);
    setQuality(null);
    setService(null);
    setSaved('');
    setReview('idle');
    setReviewError('');
  }, []);

  const onIdChange = useCallback((value: string) => {
    setClaimed(value.replace(/\D/g, '').slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 '));
    clearOutcome();
  }, [clearOutcome]);

  const choosePolicy = useCallback((id: string) => {
    const item = policies.find((p) => p.id === id);
    setPolicyId(id);
    const animal = animals.find((a) => a.id === item?.animal_id);
    if (animal) setClaimed(formatMoozzleId(animal.moozzle_id));
    clearOutcome();
  }, [animals, clearOutcome, policies]);

  const sendReview = useCallback(async (found: VerifyResult) => {
    setReview('sending');
    setReviewError('');
    try {
      await requestScanReview(found.scan_id, `Possible 1:1 match for claimed ID · similarity ${found.score.toFixed(3)}`);
      setReview('sent');
    } catch (caught) {
      console.error('Verification review request failed', caught);
      setReviewError(errorText(caught, 'The review request could not be sent. Please retry.'));
      setReview('idle');
    }
  }, []);

  const toService = useCallback((caught: unknown, uri: string, source: CaptureSource, claimedId: string) => {
    setService({ message: errorText(caught, 'The biometric service is unavailable.'), uri, source, claimed: claimedId });
    setQueued(false);
    void logAcquisitionEvent({ operation: 'verify', eventType: 'service_unavailable', reasonCode: 'service_unavailable', source });
  }, []);

  const runVerify = useCallback(async (uri: string, source: CaptureSource, claimedId: string) => {
    if (claimedId.length !== 12) {
      setError('Enter the full 12-digit claimed MOOZZLE ID first.');
      return;
    }
    setError('');
    clearOutcome();
    if (!isOnlineNow()) {
      toService(new Error('You are offline. 1:1 verification runs on the MOOZZLE service, so this capture cannot be compared yet.'), uri, source, claimedId);
      return;
    }
    setBusy(true);
    let analysed: MuzzleAnalysis | null = null;
    try {
      const analysis = await analyzeMuzzle(uri, setStage, source);
      analysed = analysis;
      setFeedback(analysis);
      if (!analysis.embedding) {
        setQuality(analysis);
        void logAcquisitionEvent({ operation: 'verify', eventType: 'failure_to_acquire', analysis });
        void logAudit('biometric.capture', claimedId, `Verification frame rejected (not compared): ${analysis.status}`, 'failed');
        return;
      }
      setProbe(analysis);
      const verified = await verifyMuzzle(claimedId, analysis, setStage);
      setResult(verified);
      if (verified.outcome === 'uncertain') void sendReview(verified);
    } catch (caught) {
      console.error('1:1 verification failed', caught);
      const kind = classifyBiometricError(caught);
      if (kind === 'service_unavailable') toService(caught, uri, source, claimedId);
      else if (kind === 'quality' && analysed) setQuality(analysed);
      else setError(errorText(caught, 'Verification could not complete. Please retry.'));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }, [clearOutcome, sendReview, toService]);

  const processPending = useCallback((item: PendingScan) => {
    removePending(item.id);
    if (item.claimedId) setClaimed(formatMoozzleId(item.claimedId));
    void runVerify(item.uri, item.source, item.claimedId ?? '');
  }, [removePending, runVerify]);

  const savePolicy = useCallback(async (outcome: PolicyOutcome) => {
    if (!policy || !result) return;
    setSaving(true);
    setError('');
    try {
      await recordVerification(policy.id, outcome, notes.trim(), Number(result.score.toFixed(3)), digits);
      setSaved(outcome === 'Verified' ? 'Identity verification recorded on the policy. The claim decision stays with the claims team.' : 'Outcome recorded and referred for manual review. No claim was approved or rejected automatically.');
    } catch (caught) {
      console.error('Policy verification save failed', caught);
      setError(errorText(caught, 'The verification could not be saved to the policy.'));
    } finally {
      setSaving(false);
    }
  }, [digits, notes, policy, result]);

  const decision = result ? decisionForOutcome(result.outcome) : null;
  const suggested: PolicyOutcome = result?.outcome === 'match' ? 'Verified' : result?.outcome === 'no_match' ? 'Mismatch' : 'Manual Review';

  return (
    <>
      <TestSessionBanner />
      <Card style={styles.card}>
        <TextField label="Claimed MOOZZLE ID (12 digits)" value={claimed} onChangeText={onIdChange} keyboardType="number-pad" placeholder="4827 3190 5614" maxLength={14} />
        {digits.length > 0 && !validId ? <Text style={styles.hint}>{12 - digits.length} more digit(s) needed.</Text> : null}
        {validId && claimedAnimal ? <Text style={styles.hint}><Text style={styles.claimTag}>Tag {tagLabel(claimedAnimal.tag_id)}</Text> · {claimedAnimal.breed} {claimedAnimal.animal_type}{claimedAnimal.farm_name || claimedAnimal.village ? ` · ${claimedAnimal.farm_name || claimedAnimal.village}` : ''}</Text> : null}
        {validId && !claimedAnimal ? <Text style={styles.hint}>Not in your downloaded records — the server checks your authorisation when you scan.</Text> : null}
        <Text style={styles.hint}>1:1 verification compares this capture only with the reference templates of the claimed ID, using the approved 1:1 threshold (separate from 1:N identification).</Text>
        {session.role === 'Insurance Officer' && policies.length > 0 ? (
          <>
            <Text style={styles.kicker}>FROM AN ASSIGNED POLICY</Text>
            <View style={styles.chips}>{policies.map((item) => <OptionChip key={item.id} label={`${item.policy_number} · ${item.verification_status}`} selected={policyId === item.id} onPress={() => choosePolicy(item.id)} tone="blue" />)}</View>
          </>
        ) : null}
      </Card>

      <PendingScansCard operation="verify" online={online} busy={busy} onProcess={processPending} />

      {!quality && !service ? <MuzzleCapture onFrame={(uri, source) => void runVerify(uri, source, digits)} busy={busy} feedback={feedback} captureLabel={online ? 'Capture & Verify' : 'Capture for Pending'} disabled={!validId} /> : null}
      {busy ? <Card style={styles.card}><Text style={styles.section}>Quality pre-check, then 1:1 comparison with the claimed identity…</Text><EnginePipeline stage={stage} /></Card> : null}
      {error ? (
        <View style={styles.errorBox}>
          <Text selectable style={styles.error}>{error}</Text>
        </View>
      ) : null}

      {quality ? <QualityInsufficientPanel analysis={quality} onRecapture={() => { setQuality(null); setFeedback(null); }} /> : null}
      {service ? (
        <>
          <ServiceUnavailablePanel
            message={service.message}
            onRetry={online ? () => void runVerify(service.uri, service.source, service.claimed) : undefined}
            onQueue={() => { addPending({ operation: 'verify', uri: service.uri, source: service.source, claimedId: service.claimed, lastError: service.message }); setQueued(true); }}
            queued={queued}
            retrying={busy}
          />
          <PrimaryButton label="Back to Capture" icon="camera-outline" variant="outline" onPress={() => setService(null)} />
        </>
      ) : null}

      {result && decision ? (
        <>
          <DecisionBanner decision={decision} subtitle={`${OUTCOME_TEXT[result.outcome]} ${reasonText(result.decision_reason)}`} />
          <TagIdentityCard
            candidate={result.animal}
            tone={decision === 'MATCH_CONFIRMED' ? 'green' : decision === 'REVIEW_REQUIRED' ? 'amber' : 'slate'}
            caption={decision === 'MATCH_CONFIRMED' ? 'Claimed identity verified by muzzle biometrics' : decision === 'REVIEW_REQUIRED' ? 'Claimed identity — NOT confirmed, review required' : 'Claimed identity — NOT accepted for this animal'}
          />
          <Card style={styles.card}>
            <Text style={styles.kicker}>CLAIMED MOOZZLE ID</Text>
            <Text selectable style={styles.id}>{formatMoozzleId(digits)}</Text>
            {decision === 'MATCH_CONFIRMED' ? <View style={styles.badge}><Ionicons name="shield-checkmark" size={16} color={colors.primary} /><Text style={styles.badgeText}>Claim verified · 1:1 config v{result.config_version}</Text></View> : null}
            <View style={styles.compare}>
              <CaptureImage uri={probe?.cropUri ?? probe?.imageUri} label="THIS SCAN" size={128} />
              <Ionicons name="swap-horizontal" size={20} color={colors.muted} />
              <CaptureImage path={result.animal.reference_image_path} label="ENROLLED" size={128} />
            </View>
            <ScoreMeter score={result.score} upper={result.verify_threshold} lower={result.review_threshold} upperLabel="Verified" />
            <Text style={styles.hint}>Best of {result.templates_compared} enrolled template(s).</Text>
            <ConfigFootnote configVersion={result.config_version} modelVersion={result.model_version} dataSource={result.data_source} />
          </Card>
          {decision === 'MATCH_CONFIRMED' && result.animal.in_scope ? <PrimaryButton label="Open Animal Record" icon="document-text-outline" onPress={() => router.push(`/animal/${digits}`)} /> : null}
          {decision === 'REVIEW_REQUIRED' ? (
            <View style={[styles.reviewBox, review === 'sent' && styles.reviewBoxSent]}>
              <Ionicons name={review === 'sent' ? 'checkmark-circle' : 'people-outline'} size={18} color={review === 'sent' ? colors.primary : colors.warning} />
              <Text style={styles.reviewText}>{review === 'sent' ? 'Sent to the review queue for an authorised reviewer.' : review === 'sending' ? 'Sending to the review queue…' : 'Not yet in the review queue.'}</Text>
            </View>
          ) : null}
          {reviewError ? <Text selectable style={styles.error}>{reviewError}</Text> : null}
          {decision === 'REVIEW_REQUIRED' && review === 'idle' ? <PrimaryButton label="Send to Review Queue" icon="people-outline" variant="soft" onPress={() => void sendReview(result)} /> : null}
          {decision !== 'MATCH_CONFIRMED' ? <PrimaryButton label="Recapture" icon="refresh-outline" variant="outline" onPress={() => { setResult(null); setFeedback(null); }} /> : null}
          {policy ? (
            <Card style={styles.card}>
              <Text style={styles.section}>Record outcome on policy {policy.policy_number}</Text>
              <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Location, lighting, who presented the animal" />
              <PrimaryButton label={saving ? 'Saving…' : `Record: ${suggested}`} icon="save-outline" onPress={() => void savePolicy(suggested)} disabled={saving || !!saved} />
              {suggested !== 'Manual Review' ? <PrimaryButton label="Refer for Manual Review" variant="outline" onPress={() => void savePolicy('Manual Review')} disabled={saving || !!saved} /> : null}
              {saved ? <Text style={styles.ok}>{saved}</Text> : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  claimTag: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  flex: { flex: 1 },
  card: { gap: 10 },
  hint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  kicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  errorBox: { gap: 8, backgroundColor: colors.dangerLight, borderRadius: 12, padding: 12 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  retry: { alignSelf: 'flex-start', minHeight: 44 },
  banner: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 16, letterSpacing: 0.5 },
  bannerText: { color: '#F8FAFC', fontFamily: Fonts.medium, fontSize: 12, marginTop: 2 },
  id: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24, letterSpacing: 1, fontVariant: ['tabular-nums'] },
  compare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 12 },
  reviewBox: { flexDirection: 'row', gap: 8, backgroundColor: colors.warningLight, borderRadius: 12, padding: 12 },
  reviewBoxSent: { backgroundColor: colors.primaryLight },
  reviewText: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  ok: { color: colors.primary, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
});
