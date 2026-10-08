import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AnimalPhoto,
  AppScreen,
  BottomNav,
  Card,
  colors,
  ErrorState,
  formatMoozzleId,
  OptionChip,
  Pill,
  PrimaryButton,
  StorageGate,
  TextField,
  Viewfinder,
} from '@/components/moozzle-ui';
import { useAppStore } from '@/store/useAppStore';
import type { Animal } from '@/store/types';
import { Fonts } from '@/constants/Typography';

type Outcome = 'verified' | 'not-verified' | null;

export default function VerifyScreen() {
  return <StorageGate><VerifyContent /></StorageGate>;
}

function VerifyContent() {
  const animals = useAppStore((state) => state.animals);
  const [idInput, setIdInput] = useState('482731905614');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [demoMode, setDemoMode] = useState<'match' | 'mismatch'>('match');
  const [error, setError] = useState('');
  const selectedAnimal = useMemo(() => animals.find((item) => item.moozzle_id === idInput.replace(/\s/g, '')), [animals, idInput]);
  const recent = useMemo(() => animals.filter((item) => item.current_status === 'Active').slice(0, 3), [animals]);

  const chooseAnimal = useCallback((animal: Animal) => {
    setIdInput(animal.moozzle_id);
    setOutcome(null);
    setError('');
  }, []);
  const handleVerify = useCallback(() => {
    try {
      const normalized = idInput.replace(/\s/g, '');
      if (!/^\d{12}$/.test(normalized)) {
        setError('Enter a valid 12-digit MOOZZLE ID.');
        return;
      }
      if (!selectedAnimal) {
        setError('That ID is not enrolled on this device. Check the ID or use a recent animal.');
        return;
      }
      setError('');
      setOutcome(demoMode === 'match' ? 'verified' : 'not-verified');
    } catch (caught) {
      console.error('Could not run 1:1 verification', caught);
      setError('Verification could not be completed. Please retry.');
    }
  }, [demoMode, idInput, selectedAnimal]);
  const openProfile = useCallback(() => {
    if (selectedAnimal) router.push(`/animal/${selectedAnimal.moozzle_id}`);
  }, [selectedAnimal]);

  if (error) return <ErrorState message={error} onRetry={() => setError('')} />;

  return (
    <AppScreen>
      <View style={styles.screenBody}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}><Text style={styles.eyebrow}>1:1 BIOMETRIC CHECK</Text><Text style={styles.title}>Verify Animal</Text><Text style={styles.subtitle}>Cross-reference a known MOOZZLE ID against a fresh muzzle scan.</Text></View>
          <Card style={styles.inputCard}><TextField label="12-digit MOOZZLE ID" value={idInput} onChangeText={(value) => { setIdInput(value.replace(/[^0-9 ]/g, '').slice(0, 14)); setOutcome(null); }} keyboardType="number-pad" maxLength={14} placeholder="4827 3190 5614" /><View style={styles.quickHeader}><Text style={styles.quickLabel}>Recently enrolled</Text><Text style={styles.quickHint}>Tap to select</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickScroll} contentContainerStyle={styles.quickContent}>{recent.map((animal) => <OptionChip key={animal.moozzle_id} label={`${formatMoozzleId(animal.moozzle_id)} · ${animal.breed}`} selected={selectedAnimal?.moozzle_id === animal.moozzle_id} onPress={() => chooseAnimal(animal)} />)}</ScrollView></Card>
          {selectedAnimal ? <Card style={styles.previewCard}><AnimalPhoto animal={selectedAnimal} size={92} /><View style={styles.previewCopy}><View style={styles.previewTitleRow}><Text style={styles.previewTitle}>{selectedAnimal.breed} {selectedAnimal.animal_type}</Text><Pill label={selectedAnimal.current_status} tone={selectedAnimal.current_status === 'Active' ? 'green' : 'red'} /></View><Text style={styles.previewMeta}>{selectedAnimal.owner_name}</Text><Text style={styles.previewMeta}>{selectedAnimal.village}, {selectedAnimal.district}, {selectedAnimal.state}</Text><Text selectable style={styles.previewId}>{formatMoozzleId(selectedAnimal.moozzle_id)}</Text></View></Card> : <View style={styles.noPreview}><Ionicons name="search-outline" size={23} color={colors.muted} /><Text style={styles.noPreviewText}>Choose an enrolled ID to preview its record.</Text></View>}
          <Viewfinder label="Align the same muzzle inside the oval for a strict 1:1 check." />
          <Card style={styles.demoCard}><View style={styles.demoHeader}><Text style={styles.demoTitle}>Demo outcome mode</Text><Pill label="Prototype only" tone="amber" /></View><View style={styles.modeRow}><OptionChip label="Match" selected={demoMode === 'match'} onPress={() => { setDemoMode('match'); setOutcome(null); }} /><OptionChip label="Mismatch" selected={demoMode === 'mismatch'} onPress={() => { setDemoMode('mismatch'); setOutcome(null); }} tone="blue" /></View></Card>
          <PrimaryButton label="Run 1:1 Biometric Verification" icon="shield-checkmark-outline" onPress={handleVerify} disabled={!selectedAnimal} />
          {outcome && selectedAnimal && <VerificationOutcome outcome={outcome} animal={selectedAnimal} onRetry={() => setOutcome(null)} onOpenProfile={openProfile} />}
          <View style={styles.disclaimer}><Ionicons name="information-circle-outline" size={19} color={colors.warning} /><Text style={styles.disclaimerText}>Confidence values are demo approximations and are not field-validated biometric accuracy.</Text></View>
        </ScrollView>
        <BottomNav active="verify" />
      </View>
    </AppScreen>
  );
}

function VerificationOutcome({ outcome, animal, onRetry, onOpenProfile }: { outcome: Exclude<Outcome, null>; animal: Animal; onRetry: () => void; onOpenProfile: () => void }) {
  const verified = outcome === 'verified';
  return <View style={[styles.outcomeCard, verified ? styles.outcomeVerified : styles.outcomeMismatch]}><View style={[styles.outcomeIcon, verified ? styles.outcomeIconVerified : styles.outcomeIconMismatch]}><Ionicons name={verified ? 'checkmark' : 'close'} size={28} color={colors.surface} /></View><Text style={[styles.outcomeTitle, !verified && styles.outcomeTitleDanger]}>{verified ? 'VERIFIED ✓' : 'NOT VERIFIED ✗'}</Text><Text style={styles.outcomeScore}>{verified ? 'Confidence: 93% demo score · above threshold' : 'Confidence: 34% demo score · below threshold'}</Text><Text style={styles.outcomeBody}>{verified ? 'The scanned muzzle is consistent with the selected enrolled reference.' : 'The scan does not meet the demo threshold. Retry with clean, steady lighting or check the claimed ID.'}</Text><View style={styles.outcomeActions}><PrimaryButton label="Retry Scan" onPress={onRetry} variant={verified ? 'outline' : 'danger'} style={styles.outcomeButton} />{verified && <PrimaryButton label="Open Livestock Service Hub" icon="arrow-forward" onPress={onOpenProfile} style={styles.outcomeButton} />}</View><Text selectable style={styles.outcomeSmall}>Selected ID: {formatMoozzleId(animal.moozzle_id)}</Text></View>;
}

const styles = StyleSheet.create({
  screenBody: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 20, gap: 15 },
  titleBlock: { gap: 5 },
  eyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.1 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 29 },
  subtitle: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  inputCard: { gap: 13 },
  quickHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quickLabel: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  quickHint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  quickScroll: { flexGrow: 0 },
  quickContent: { gap: 8, paddingRight: 6 },
  previewCard: { flexDirection: 'row', gap: 13, alignItems: 'center' },
  previewCopy: { flex: 1, gap: 5 },
  previewTitleRow: { flexDirection: 'row', gap: 7, alignItems: 'center', flexWrap: 'wrap' },
  previewTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  previewMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  previewId: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 13, fontVariant: ['tabular-nums'], marginTop: 2 },
  noPreview: { minHeight: 70, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 5 },
  noPreviewText: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 13 },
  demoCard: { gap: 12 },
  demoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  demoTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  modeRow: { flexDirection: 'row', gap: 9 },
  outcomeCard: { borderRadius: 16, padding: 18, alignItems: 'center', gap: 9 },
  outcomeVerified: { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: '#BCE5C5' },
  outcomeMismatch: { backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#F5B9B9' },
  outcomeIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  outcomeIconVerified: { backgroundColor: colors.accent },
  outcomeIconMismatch: { backgroundColor: colors.danger },
  outcomeTitle: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 21 },
  outcomeTitleDanger: { color: colors.danger },
  outcomeScore: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, textAlign: 'center' },
  outcomeBody: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  outcomeActions: { width: '100%', flexDirection: 'row', gap: 9, marginTop: 5 },
  outcomeButton: { flex: 1, paddingHorizontal: 7 },
  outcomeSmall: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11 },
  disclaimer: { flexDirection: 'row', gap: 7, backgroundColor: colors.warningLight, padding: 11, borderRadius: 10, alignItems: 'flex-start' },
  disclaimerText: { color: '#845A1A', flex: 1, fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16 },
});
