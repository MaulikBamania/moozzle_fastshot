import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { Card, colors, DataGate, EmptyState, formatMoozzleId, OptionChip, Pill, PrimaryButton, TextField, Viewfinder } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { logAudit, messageOf, recordVerification, useBovineData, useBovineStore } from '@/store/useBovineStore';
import type { PolicyRow } from '@/store/types';

type Stage = 'select' | 'capture' | 'comparing' | 'result';
type Simulated = 'same' | 'different' | 'unclear';

export default function VerifyScreen() {
  return (
    <DataGate>
      <StackScreen title="Verify Animal" eyebrow="Insurance identity check" destination="verify">
        <VerifyContent />
      </StackScreen>
    </DataGate>
  );
}

function VerifyContent() {
  const params = useLocalSearchParams<{ policy?: string }>();
  const policies = useBovineStore((state) => state.policyRows);
  const threshold = useBovineStore((state) => Number(state.settings.find((item) => item.key === 'biometric_threshold')?.value ?? 0.82));
  const { animals } = useBovineData();
  const [policyId, setPolicyId] = useState<string | null>(params.policy ?? null);
  const [stage, setStage] = useState<Stage>(params.policy ? 'capture' : 'select');
  const [simulated, setSimulated] = useState<Simulated>('same');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const policy = policies.find((item) => item.id === policyId) ?? null;
  const animal = useMemo(() => animals.find((item) => item.id === policy?.animal_id), [animals, policy?.animal_id]);
  // Illustrative scores for the selected simulated outcome (no recognition model connected).
  const score = simulated === 'same' ? 0.94 : simulated === 'different' ? 0.31 : threshold - 0.04;
  const suggested: 'Verified' | 'Mismatch' | 'Manual Review' = simulated === 'same' ? 'Verified' : simulated === 'different' ? 'Mismatch' : 'Manual Review';

  useEffect(() => {
    if (stage !== 'comparing') return undefined;
    const timer = setTimeout(() => setStage('result'), 1800);
    return () => clearTimeout(timer);
  }, [stage]);

  const choose = useCallback((item: PolicyRow) => {
    setPolicyId(item.id);
    setStage('capture');
    setSaved('');
    setError('');
  }, []);

  const save = useCallback(async (outcome: 'Verified' | 'Mismatch' | 'Manual Review' | 'Exception') => {
    if (!policy || !animal) return;
    setSaving(true);
    setError('');
    try {
      await recordVerification(policy.id, outcome, notes.trim(), Number(score.toFixed(2)), animal.moozzle_id);
      setSaved(outcome === 'Verified' ? 'Identity verified and recorded. The claim decision stays with the claims team.' : 'Outcome recorded and referred for manual review. No claim was approved or rejected automatically.');
    } catch (caught) {
      console.error('Verification save failed', caught);
      setError(messageOf(caught, 'The verification could not be saved.'));
    } finally {
      setSaving(false);
    }
  }, [animal, notes, policy, score]);

  if (policies.length === 0) return <EmptyState title="No assigned policies" message="Policies assigned to your insurance company appear here." />;

  return (
    <>
      <View style={styles.steps}>
        {['Select policy', 'Capture muzzle', 'Compare', 'Record outcome'].map((label, index) => {
          const active = ['select', 'capture', 'comparing', 'result'].indexOf(stage) >= index;
          return <Pill key={label} label={`${index + 1}. ${label}`} tone={active ? 'green' : 'slate'} />;
        })}
      </View>

      {stage === 'select' ? (
        <>
          <Text style={styles.section}>Assigned policies and claims</Text>
          {policies.map((item) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.row}><Text selectable style={styles.policy}>{item.policy_number}</Text><Pill label={item.verification_status} tone={item.verification_status === 'Verified' ? 'green' : item.verification_status === 'Pending' ? 'amber' : 'red'} /></View>
              <Text style={styles.muted}>Holder {item.holder_name} · ₹{item.coverage_amount.toLocaleString('en-IN')} · Claim: {item.claim_status}</Text>
              <PrimaryButton label="Verify this animal" icon="shield-checkmark-outline" onPress={() => choose(item)} />
            </Card>
          ))}
        </>
      ) : null}

      {policy && animal && stage !== 'select' ? (
        <Card style={styles.card}>
          <Text style={styles.kicker}>REGISTERED IDENTITY ON POLICY {policy.policy_number}</Text>
          <Text selectable style={styles.id}>{formatMoozzleId(animal.moozzle_id)}</Text>
          <Text style={styles.muted}>{animal.breed} {animal.animal_type} · {animal.sex} · {animal.age_years} yrs · {animal.district}</Text>
        </Card>
      ) : null}
      {policy && !animal && stage !== 'select' ? <Text style={styles.error}>The insured animal is not available to your role.</Text> : null}

      {stage === 'capture' && animal ? (
        <>
          <Viewfinder label="Capture the muzzle of the animal presented for the claim." />
          <Card style={styles.card}>
            <Text style={styles.simLabel}>Simulated comparison result (no recognition model connected)</Text>
            <View style={styles.chips}>
              <OptionChip label="Same animal" selected={simulated === 'same'} onPress={() => setSimulated('same')} />
              <OptionChip label="Different animal" selected={simulated === 'different'} onPress={() => setSimulated('different')} tone="red" />
              <OptionChip label="Unclear / near threshold" selected={simulated === 'unclear'} onPress={() => setSimulated('unclear')} tone="blue" />
            </View>
          </Card>
          <View style={styles.row}>
            <PrimaryButton label="Change Policy" variant="outline" onPress={() => setStage('select')} style={styles.flex} />
            <PrimaryButton label="Capture & Compare" icon="scan-outline" onPress={() => setStage('comparing')} style={styles.flex} />
          </View>
        </>
      ) : null}

      {stage === 'comparing' ? (
        <Card style={styles.center}>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.muted}>Comparing capture with the registered template (1:1)…</Text>
        </Card>
      ) : null}

      {stage === 'result' && animal ? (
        <>
          <Card style={styles.card}>
            <View style={styles.row}>
              <Ionicons name={suggested === 'Verified' ? 'checkmark-circle' : suggested === 'Mismatch' ? 'close-circle' : 'help-circle'} size={28} color={suggested === 'Verified' ? colors.primary : suggested === 'Mismatch' ? colors.danger : colors.warning} />
              <View style={styles.flex}>
                <Text style={styles.resultTitle}>{suggested === 'Verified' ? 'Match above threshold' : suggested === 'Mismatch' ? 'Does not match registered identity' : 'Uncertain match'}</Text>
                <Text style={styles.muted}>Illustrative score {score.toFixed(2)} · threshold {threshold.toFixed(2)}</Text>
              </View>
            </View>
            <Text style={styles.note}>A biometric result never approves or rejects a claim by itself. Record the verification outcome; disputed or uncertain matches go to manual review.</Text>
            <TextField label="Verification notes" value={notes} onChangeText={setNotes} placeholder="Field observations, ear notch, colour…" multiline />
          </Card>
          {saved ? (
            <View style={styles.saved}><Text selectable style={styles.savedText}>{saved}</Text><PrimaryButton label="Open Animal Record" variant="outline" onPress={() => router.push({ pathname: '/animal/[id]', params: { id: animal.moozzle_id, tab: 'insurance' } })} /><PrimaryButton label="Verify Another" onPress={() => { setStage('select'); setSaved(''); setNotes(''); void logAudit('biometric.verify', '', 'Verification session closed', 'success'); }} /></View>
          ) : (
            <View style={styles.actions}>
              <PrimaryButton label={saving ? 'Saving…' : 'Record: Verified'} icon="checkmark" onPress={() => void save('Verified')} disabled={saving || suggested !== 'Verified'} />
              <PrimaryButton label="Refer for Manual Review" icon="people-outline" variant="blue" onPress={() => void save('Manual Review')} disabled={saving} />
              <PrimaryButton label="Record Mismatch / Suspected Duplicate" icon="warning-outline" variant="danger" onPress={() => void save(suggested === 'Mismatch' ? 'Mismatch' : 'Exception')} disabled={saving} />
            </View>
          )}
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  section: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  card: { gap: 10 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  policy: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  kicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.9 },
  id: { color: colors.text, fontFamily: Fonts.bold, fontSize: 22, fontVariant: ['tabular-nums'] },
  simLabel: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resultTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  note: { color: '#075985', backgroundColor: colors.blueLight, borderRadius: 10, padding: 10, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  actions: { gap: 10 },
  saved: { gap: 10, backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14 },
  savedText: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 14 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
});
