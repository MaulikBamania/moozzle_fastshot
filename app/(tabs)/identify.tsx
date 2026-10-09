import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RequireAccess, TabShell } from '@/components/app-chrome';
import { AnimalPhoto, Card, colors, DataGate, formatMoozzleId, OptionChip, PipelineList, Pill, PrimaryButton, TextField, tr, Viewfinder } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { usesTechnicalLanguage } from '@/lib/rbac';
import { useAppStore } from '@/store/useAppStore';
import { logAudit, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';
import { useIsOnline } from '@/store/useConnectivity';
import type { Animal } from '@/store/types';

type Quality = 'good' | 'closer' | 'dark' | 'blurry';
type Outcome = 'match' | 'no-match';

const QUALITY: Record<Quality, { label: string; tone: 'green' | 'amber' | 'red'; hint: string }> = {
  good: { label: 'Good ✓', tone: 'green', hint: 'Clean muzzle · steady light · no shadows' },
  closer: { label: 'Move closer', tone: 'amber', hint: 'Fill the oval with the muzzle (15–25 cm away)' },
  dark: { label: 'Too dark', tone: 'red', hint: 'Turn toward daylight or switch on the torch' },
  blurry: { label: 'Too blurry', tone: 'red', hint: 'Hold the phone steady and wait for focus' },
};

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
  const threshold = useBovineStore((state) => Number(state.settings.find((item) => item.key === 'biometric_threshold')?.value ?? 0.82));
  const online = useIsOnline();
  const technical = session.role ? usesTechnicalLanguage(session.role) : true;
  const [quality, setQuality] = useState<Quality>('good');
  const [captured, setCaptured] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('match');
  const [scanning, setScanning] = useState(false);
  const [pipelineIndex, setPipelineIndex] = useState(0);
  const [result, setResult] = useState<Animal | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [fromLookup, setFromLookup] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const outcomeRef = useRef(outcome);
  useEffect(() => {
    outcomeRef.current = outcome;
  }, [outcome]);

  const steps = technical ? ['Detecting muzzle', 'Extracting ridge pattern', `Comparing with authorised templates (threshold ${threshold.toFixed(2)})`] : ['Checking photo', 'Reading muzzle pattern', 'Looking for your animal'];
  // Only animals in the active role's server-authorised scope are candidates.
  const candidates = useMemo(() => animals.filter((item) => item.current_status === 'Active' && item.biometric_status === 'Enrolled' && item.approval_status !== 'Draft'), [animals]);
  const lookupResults = useMemo(() => {
    const normalized = query.replace(/\s/g, '').toLowerCase();
    if (normalized.length < 3) return [];
    return animals.filter((item) => [item.moozzle_id, item.breed, item.farm_name.replace(/\s/g, ''), item.village.replace(/\s/g, '')].some((value) => value.toLowerCase().includes(normalized))).slice(0, 6);
  }, [animals, query]);

  useEffect(() => {
    if (!scanning) return undefined;
    const timer = setInterval(() => {
      setPipelineIndex((current) => {
        if (current < steps.length) return current + 1;
        clearInterval(timer);
        setScanning(false);
        const match = outcomeRef.current === 'match' ? candidates[0] : undefined;
        if (match) {
          setResult(match);
          setNoMatch(false);
          void logAudit('biometric.identify', match.moozzle_id, `1:N scan matched within ${candidates.length} authorised templates`, 'success');
        } else {
          setResult(null);
          setNoMatch(true);
          // A failed match never reveals which records exist outside the user's scope.
          void logAudit('biometric.identify', '', `1:N scan found no match within ${candidates.length} authorised templates`, 'no_match');
        }
        return current;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [candidates, scanning, steps.length]);

  const handleCapture = useCallback(() => {
    if (quality !== 'good') {
      setMessage(`Image rejected: ${QUALITY[quality].label}. ${QUALITY[quality].hint}.`);
      void logAudit('biometric.capture', '', `Capture rejected by quality check (${quality})`, 'failed');
      return;
    }
    setMessage('');
    setCaptured(true);
  }, [quality]);
  const handleRetake = useCallback(() => {
    setCaptured(false);
    setMessage('');
  }, []);
  const handleSubmit = useCallback(() => {
    setResult(null);
    setNoMatch(false);
    setCopied(false);
    setFromLookup(false);
    setPipelineIndex(0);
    setScanning(true);
  }, []);
  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await Clipboard.setStringAsync(result.moozzle_id);
      setCopied(true);
    } catch (caught) {
      console.error('Could not copy MOOZZLE ID', caught);
      setMessage('Copy is unavailable on this device. The ID remains selectable.');
    }
  }, [result]);
  const chooseLookup = useCallback((animal: Animal) => {
    setResult(animal);
    setNoMatch(false);
    setFromLookup(true);
    setCopied(false);
    setQuery('');
    void logAudit('record.view', animal.moozzle_id, 'Looked up by MOOZZLE ID / filter', 'success');
  }, []);
  const reset = useCallback(() => {
    setResult(null);
    setNoMatch(false);
    setCaptured(false);
    setCopied(false);
    setPipelineIndex(0);
  }, []);

  const idle = !result && !scanning && !noMatch;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{technical ? '1:N BIOMETRIC SEARCH' : 'FIND MY ANIMAL'}</Text>
          <Text style={styles.title}>{tr(language, 'identifyAnimal')}</Text>
        </View>
        <Pill label={online ? 'Online' : 'Offline'} tone={online ? 'green' : 'amber'} />
      </View>
      <Text style={styles.subtitle}>{technical ? `Searches only the ${candidates.length} enrolled animals your role is authorised to see.` : 'Take a clear photo of the nose of your animal.'}</Text>

      {!online ? (
        <View style={styles.warn}><Ionicons name="cloud-offline-outline" size={18} color={colors.warning} /><Text style={styles.warnText}>Offline: biometric matching needs an on-device model and local reference database, which are not installed. Use ID lookup on records already downloaded.</Text></View>
      ) : null}

      {idle && online ? (
        <>
          <Viewfinder label={captured ? 'Frame captured. Submit to identify, or retake.' : 'Position muzzle inside the oval frame.'} />
          <Card style={styles.qualityCard}>
            <View style={styles.qualityRow}><Pill label={QUALITY[quality].label} tone={QUALITY[quality].tone} /><Text style={styles.qualityHint}>{QUALITY[quality].hint}</Text></View>
            <Text style={styles.simLabel}>Prototype capture conditions (no camera model connected)</Text>
            <View style={styles.chips}>{(Object.keys(QUALITY) as Quality[]).map((key) => <OptionChip key={key} label={QUALITY[key].label} selected={quality === key} onPress={() => { setQuality(key); setCaptured(false); }} />)}</View>
            <Text style={styles.simLabel}>Simulated match outcome</Text>
            <View style={styles.chips}>
              <OptionChip label="Registered animal" selected={outcome === 'match'} onPress={() => setOutcome('match')} />
              <OptionChip label="Unknown animal" selected={outcome === 'no-match'} onPress={() => setOutcome('no-match')} tone="red" />
            </View>
          </Card>
          {message ? <Text selectable style={styles.errorText}>{message}</Text> : null}
          <View style={styles.buttonRow}>
            {captured ? <PrimaryButton label="Retake" icon="refresh-outline" variant="outline" onPress={handleRetake} style={styles.half} /> : null}
            {captured ? (
              <PrimaryButton label="Submit & Match" icon="scan-outline" variant="blue" onPress={handleSubmit} style={styles.half} />
            ) : (
              <PrimaryButton label="Capture Muzzle" icon="camera-outline" onPress={handleCapture} style={styles.full} />
            )}
          </View>
        </>
      ) : null}

      {scanning ? (
        <Card style={styles.processing}>
          <View style={styles.processingHead}><ActivityIndicator color={colors.blue} /><Text style={styles.processingTitle}>{technical ? `Searching ${candidates.length} authorised templates` : 'Looking for your animal…'}</Text></View>
          <PipelineList steps={steps} activeStep={pipelineIndex} />
        </Card>
      ) : null}

      {noMatch ? (
        <Card style={styles.noMatch}>
          <View style={styles.noMatchIcon}><Ionicons name="help-circle-outline" size={30} color={colors.warning} /></View>
          <Text style={styles.noMatchTitle}>{technical ? 'No match in your authorised records' : 'We could not find this animal'}</Text>
          <Text style={styles.noMatchText}>{technical ? 'The scan did not reach the match threshold against animals in your scope. No information about other records is shown. Retake in better light, or register the animal if authorised.' : 'Try again in daylight, or ask your field worker to register it.'}</Text>
          <PrimaryButton label="Scan Again" icon="refresh-outline" onPress={reset} />
        </Card>
      ) : null}

      {result ? (
        <View style={styles.resultStack}>
          <View style={styles.banner}>
            <View style={styles.bannerIcon}><Ionicons name="checkmark" size={22} color={colors.surface} /></View>
            <View style={styles.flex}>
              <Text style={styles.bannerTitle}>{fromLookup ? 'RECORD FOUND' : tr(language, 'identified').toUpperCase()}</Text>
              <Text style={styles.bannerSubtitle}>{fromLookup ? 'Matched by ID lookup' : technical ? 'Simulated match · illustrative 94% score' : 'This is your registered animal'}</Text>
            </View>
          </View>
          <Card style={styles.resultCard}>
            <View style={styles.idHeader}>
              <View><Text style={styles.idKicker}>MOOZZLE ID</Text><Text selectable style={styles.resultId}>{formatMoozzleId(result.moozzle_id)}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Copy MOOZZLE ID" onPress={() => void handleCopy()} style={styles.copy}><Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.primary} /><Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text></Pressable>
            </View>
            <View style={styles.summary}><AnimalPhoto animal={result} size={56} /><View style={styles.flex}><Text style={styles.summaryText}>{result.breed} {result.animal_type} · {result.sex} · {result.age_years} yrs</Text><Text style={styles.summaryMeta}>{result.farm_name || result.village}{result.owner_visible && result.owner_name ? ` · ${result.owner_name}` : ''}</Text></View></View>
            {!result.owner_visible ? <Text style={styles.restricted}><Ionicons name="lock-closed-outline" size={12} color={colors.muted} /> Owner details are not shared with your role.</Text> : null}
            {!fromLookup && technical ? <Text style={styles.model}>Threshold {threshold.toFixed(2)} · prototype simulation, replace with a validated model</Text> : null}
          </Card>
          <View style={styles.buttonRow}>
            <PrimaryButton label="Open Record" icon="document-text-outline" onPress={() => router.push(`/animal/${result.moozzle_id}`)} style={styles.half} />
            <PrimaryButton label="Scan Next" icon="scan-outline" variant="outline" onPress={reset} style={styles.half} />
          </View>
        </View>
      ) : null}

      {idle ? (
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
        </Card>
      ) : null}

      <View style={styles.disclaimer}><Ionicons name="information-circle-outline" size={18} color={colors.warning} /><Text style={styles.disclaimerText}>Prototype: no camera or muzzle-recognition model is connected yet. Capture quality and the match outcome are chosen above for testing; matches only ever come from your authorised Supabase records, and every attempt is written to the audit trail.</Text></View>
    </ScrollView>
  );
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
  qualityCard: { gap: 10 },
  qualityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qualityHint: { flex: 1, color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  simLabel: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minHeight: 54 },
  full: { flex: 1, minHeight: 56 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  processing: { gap: 18 },
  processingHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  processingTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  noMatch: { alignItems: 'center', gap: 10 },
  noMatchIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' },
  noMatchTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, textAlign: 'center' },
  noMatchText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  resultStack: { gap: 12 },
  banner: { borderRadius: 14, backgroundColor: colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 15 },
  bannerSubtitle: { color: '#D1FAE5', fontFamily: Fonts.medium, fontSize: 12, marginTop: 2 },
  resultCard: { gap: 12 },
  idHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  idKicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  resultId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24, letterSpacing: 1, fontVariant: ['tabular-nums'], marginTop: 3 },
  copy: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 12 },
  copyText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 12 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryText: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  summaryMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, marginTop: 2 },
  restricted: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  model: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  lookup: { gap: 10 },
  lookupEmpty: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  lookupRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  lookupId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  lookupMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  pressed: { opacity: 0.8 },
  disclaimer: { flexDirection: 'row', gap: 7, backgroundColor: colors.warningLight, padding: 11, borderRadius: 10 },
  disclaimerText: { color: '#845A1A', flex: 1, fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16 },
});
