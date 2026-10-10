import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { StackScreen } from '@/components/app-chrome';
import { CaptureImage, EnginePipeline, errorText, MuzzleCapture, ScoreMeter } from '@/components/biometric-ui';
import { Card, colors, DataGate, formatMoozzleId, OptionChip, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { analyzeMuzzle, verifyMuzzle } from '@/lib/biometric/engine';
import { logAudit, recordVerification, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';
import type { MuzzleAnalysis, PipelineStage, VerifyResult } from '@/store/types';

type PolicyOutcome = 'Verified' | 'Mismatch' | 'Manual Review' | 'Exception';

const OUTCOME_COPY = {
  match: { title: 'VERIFIED', tone: colors.primary, icon: 'shield-checkmark' as const, text: 'The scanned muzzle matches the claimed MOOZZLE ID.' },
  no_match: { title: 'NOT VERIFIED', tone: colors.danger, icon: 'close-circle' as const, text: 'The scanned muzzle does not match the claimed MOOZZLE ID.' },
  uncertain: { title: 'INCONCLUSIVE — TRY AGAIN', tone: colors.warning, icon: 'help-circle' as const, text: 'The similarity is between the review and verify thresholds. Capture a clearer frame.' },
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
  const [feedback, setFeedback] = useState<MuzzleAnalysis | null>(null);
  const [probe, setProbe] = useState<MuzzleAnalysis | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  const digits = claimed.replace(/\D/g, '');
  const validId = digits.length === 12;
  const policy = policies.find((item) => item.id === policyId) ?? null;
  const claimedAnimal = useMemo(() => animals.find((item) => item.moozzle_id === digits), [animals, digits]);

  const onIdChange = useCallback((value: string) => {
    setClaimed(value.replace(/\D/g, '').slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 '));
    setResult(null);
    setSaved('');
  }, []);

  const choosePolicy = useCallback((id: string) => {
    const item = policies.find((p) => p.id === id);
    setPolicyId(id);
    const animal = animals.find((a) => a.id === item?.animal_id);
    if (animal) setClaimed(formatMoozzleId(animal.moozzle_id));
    setResult(null);
    setSaved('');
  }, [animals, policies]);

  const handleFrame = useCallback(async (uri: string) => {
    if (!validId) {
      setError('Enter the full 12-digit claimed MOOZZLE ID first.');
      return;
    }
    setError('');
    setResult(null);
    setSaved('');
    setPendingUri(uri);
    setBusy(true);
    try {
      const analysis = await analyzeMuzzle(uri, setStage);
      setFeedback(analysis);
      if (!analysis.embedding) {
        setPendingUri(null);
        void logAudit('biometric.capture', digits, `Verification frame rejected: ${analysis.status}`, 'failed');
        return;
      }
      setProbe(analysis);
      const verified = await verifyMuzzle(digits, analysis, setStage);
      setResult(verified);
      setPendingUri(null);
    } catch (caught) {
      console.error('1:1 verification failed', caught);
      setError(errorText(caught, 'Verification could not complete. Check your connection and retry.'));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }, [digits, validId]);

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

  const copy = result ? OUTCOME_COPY[result.outcome] : null;
  const suggested: PolicyOutcome = result?.outcome === 'match' ? 'Verified' : result?.outcome === 'no_match' ? 'Mismatch' : 'Manual Review';

  return (
    <>
      <Card style={styles.card}>
        <TextField label="Claimed MOOZZLE ID (12 digits)" value={claimed} onChangeText={onIdChange} keyboardType="number-pad" placeholder="4827 3190 5614" maxLength={14} />
        {digits.length > 0 && !validId ? <Text style={styles.hint}>{12 - digits.length} more digit(s) needed.</Text> : null}
        {validId && claimedAnimal ? <Text style={styles.hint}>{claimedAnimal.breed} {claimedAnimal.animal_type} · {claimedAnimal.farm_name || claimedAnimal.village}</Text> : null}
        {validId && !claimedAnimal ? <Text style={styles.hint}>Not in your downloaded records — the server checks your authorisation when you scan.</Text> : null}
        {session.role === 'Insurance Officer' && policies.length > 0 ? (
          <>
            <Text style={styles.kicker}>FROM AN ASSIGNED POLICY</Text>
            <View style={styles.chips}>{policies.map((item) => <OptionChip key={item.id} label={`${item.policy_number} · ${item.verification_status}`} selected={policyId === item.id} onPress={() => choosePolicy(item.id)} tone="blue" />)}</View>
          </>
        ) : null}
      </Card>

      <MuzzleCapture onFrame={(uri) => void handleFrame(uri)} busy={busy} feedback={feedback} captureLabel="Capture & Verify" disabled={!validId} />
      {busy ? <Card style={styles.card}><Text style={styles.section}>Comparing with the claimed identity (1:1)…</Text><EnginePipeline stage={stage} /></Card> : null}
      {error ? (
        <View style={styles.errorBox}>
          <Text selectable style={styles.error}>{error}</Text>
          {pendingUri ? <PrimaryButton label="Retry" icon="refresh-outline" variant="outline" onPress={() => void handleFrame(pendingUri)} style={styles.retry} /> : null}
        </View>
      ) : null}

      {result && copy ? (
        <>
          <View style={[styles.banner, { backgroundColor: copy.tone }]}>
            <Ionicons name={copy.icon} size={26} color={colors.surface} />
            <View style={styles.flex}><Text style={styles.bannerTitle}>{copy.title}</Text><Text style={styles.bannerText}>{copy.text}</Text></View>
          </View>
          <Card style={styles.card}>
            <Text style={styles.kicker}>CLAIMED IDENTITY</Text>
            <Text selectable style={styles.id}>{formatMoozzleId(digits)}</Text>
            <View style={styles.compare}>
              <CaptureImage uri={probe?.cropUri ?? probe?.imageUri} label="THIS SCAN" size={128} />
              <Ionicons name="swap-horizontal" size={20} color={colors.muted} />
              <CaptureImage path={result.animal.reference_image_path} label="ENROLLED" size={128} />
            </View>
            <ScoreMeter score={result.score} upper={result.verify_threshold} lower={result.review_threshold} upperLabel="Verified" />
            <Text style={styles.hint}>Best of {result.templates_compared} enrolled template(s). Logged to the audit trail.</Text>
          </Card>
          {result.outcome === 'match' && result.animal.in_scope ? <PrimaryButton label="Open Animal Record" icon="document-text-outline" onPress={() => router.push(`/animal/${digits}`)} /> : null}
          {result.outcome === 'uncertain' ? <PrimaryButton label="Try Again" icon="refresh-outline" variant="outline" onPress={() => { setResult(null); setFeedback(null); }} /> : null}
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
  ok: { color: colors.primary, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
});
