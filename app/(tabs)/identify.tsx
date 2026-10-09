import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AnimalPhoto,
  AppScreen,
  BottomNav,
  Card,
  colors,
  ErrorState,
  formatMoozzleId,
  PipelineList,
  Pill,
  PrimaryButton,
  DataGate,
  EmptyState,
  TextField,
  Viewfinder,
} from '@/components/moozzle-ui';
import { MODEL_VERSION, useBovineData } from '@/store/useBovineStore';
import type { Animal } from '@/store/types';
import { Fonts } from '@/constants/Typography';

const identifySteps = ['Detecting muzzle', 'Extracting 256-D ridge pattern', 'Comparing with registered templates'];

export default function IdentifyScreen() {
  return <DataGate><IdentifyContent /></DataGate>;
}

function IdentifyContent() {
  const { animals, templates } = useBovineData();
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pipelineIndex, setPipelineIndex] = useState(0);
  const [result, setResult] = useState<Animal | null>(null);
  const [fromLookup, setFromLookup] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const candidates = useMemo(() => {
    const enrolled = new Set(templates.map((template) => template.animal_id));
    return animals.filter((item) => item.current_status === 'Active' && enrolled.has(item.id));
  }, [animals, templates]);
  // Prototype: no on-device model yet, so the simulated scan resolves to the latest active enrolment.
  const demoCandidate = candidates[0];
  const lookupResults = useMemo(() => {
    const normalized = query.replace(/\s/g, '').toLowerCase();
    if (normalized.length < 3) return [];
    return animals.filter((item) => [item.moozzle_id, item.owner_name.replace(/\s/g, ''), item.village.replace(/\s/g, ''), item.breed].some((value) => value.toLowerCase().includes(normalized))).slice(0, 5);
  }, [animals, query]);

  useEffect(() => {
    if (!scanning) return undefined;
    const timer = setInterval(() => {
      setPipelineIndex((current) => {
        if (current >= identifySteps.length) {
          clearInterval(timer);
          setScanning(false);
          setFromLookup(false);
          setResult(demoCandidate ?? null);
          return current;
        }
        return current + 1;
      });
    }, 720);
    return () => clearInterval(timer);
  }, [demoCandidate, scanning]);

  const handleScan = useCallback(() => {
    try {
      if (!demoCandidate) {
        setError('You have no active enrolled bovines to compare against yet. Register an animal first.');
        return;
      }
      setError('');
      setResult(null);
      setCopied(false);
      setPipelineIndex(0);
      setScanning(true);
    } catch (caught) {
      console.error('Could not start identification scan', caught);
      setError('The scanner could not start. Please retry.');
    }
  }, [demoCandidate]);
  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await Clipboard.setStringAsync(result.moozzle_id);
      setCopied(true);
    } catch (caught) {
      console.error('Could not copy MOOZZLE ID', caught);
      setError('Copy is unavailable on this device. The ID remains selectable.');
    }
  }, [result]);
  const chooseLookup = useCallback((animal: Animal) => {
    setResult(animal);
    setFromLookup(true);
    setCopied(false);
    setQuery('');
  }, []);
  const clearResult = useCallback(() => {
    setResult(null);
    setCopied(false);
    setPipelineIndex(0);
  }, []);
  const openRecord = useCallback(() => {
    if (result) router.push(`/animal/${result.moozzle_id}`);
  }, [result]);

  if (error) return <ErrorState message={error} onRetry={() => setError('')} />;

  return (
    <AppScreen>
      <View style={styles.screenBody}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}><Text style={styles.eyebrow}>1:N BIOMETRIC SEARCH</Text><Text style={styles.title}>Identify Animal</Text><Text style={styles.subtitle}>Scan a muzzle or look up an ID to find a bovine in your cloud archive.</Text></View>
          {!result && !scanning && <Viewfinder label="Position muzzle inside the oval frame. Keep distance ~15-25 cm." />}
          {scanning && <Card style={styles.processingCard}><View style={styles.searchHeader}><View style={styles.radarIcon}><Ionicons name="scan-outline" size={26} color={colors.blue} /></View><View><Text style={styles.processingTitle}>Searching {candidates.length} enrolled {candidates.length === 1 ? 'template' : 'templates'}</Text><Text style={styles.processingSubtitle}>Prototype 1:N simulation in progress</Text></View><ActivityIndicator color={colors.blue} /></View><PipelineList steps={identifySteps} activeStep={pipelineIndex} /></Card>}
          {!result && !scanning && <View style={styles.qualityRow}><Pill label="Good ✓" /><Text style={styles.qualityInstruction}>Clean muzzle · steady lighting · no shadows</Text></View>}
          {!result && !scanning && <PrimaryButton label="Scan Muzzle & Identify" icon="scan-outline" variant="blue" onPress={handleScan} disabled={candidates.length === 0} />}
          {!result && !scanning && candidates.length === 0 && (
            <View style={styles.firstRun}>
              <EmptyState title="Nothing to identify against" message="Your archive has no active enrolled bovines yet." />
              <PrimaryButton label="Enrol First Bovine" icon="add" onPress={() => router.push('/register')} />
            </View>
          )}
          {!result && !scanning && animals.length > 0 && (
            <Card style={styles.lookupCard}>
              <TextField label="Look up by MOOZZLE ID, owner, village or breed" value={query} onChangeText={setQuery} placeholder="e.g. 4827 or Patel" autoCapitalize="none" />
              {query.replace(/\s/g, '').length >= 3 && lookupResults.length === 0 && <Text style={styles.lookupEmpty}>No bovine in your archive matches “{query.trim()}”.</Text>}
              {lookupResults.map((animal) => (
                <Pressable accessibilityRole="button" key={animal.id} onPress={() => chooseLookup(animal)} style={({ pressed }) => [styles.lookupRow, pressed && styles.pressed]}>
                  <AnimalPhoto animal={animal} size={44} />
                  <View style={styles.lookupCopy}><Text selectable style={styles.lookupId}>{formatMoozzleId(animal.moozzle_id)}</Text><Text style={styles.lookupMeta}>{animal.breed} · {animal.owner_name} · {animal.village}</Text></View>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </Card>
          )}
          {result && <IdentificationResult animal={result} fromLookup={fromLookup} copied={copied} onCopy={handleCopy} onOpenRecord={openRecord} onNext={clearResult} />}
          <View style={styles.disclaimer}><Ionicons name="information-circle-outline" size={19} color={colors.warning} /><Text style={styles.disclaimerText}>Prototype scan simulation: no muzzle model runs yet, so a scan returns your latest active enrolment with an illustrative score. ID lookup searches your real Supabase records.</Text></View>
        </ScrollView>
        <BottomNav active="identify" />
      </View>
    </AppScreen>
  );
}

function IdentificationResult({ animal, fromLookup, copied, onCopy, onOpenRecord, onNext }: { animal: Animal; fromLookup: boolean; copied: boolean; onCopy: () => void; onOpenRecord: () => void; onNext: () => void }) {
  return (
    <View style={styles.resultStack}>
      <View style={styles.identifiedBanner}><View style={styles.bannerIcon}><Ionicons name="checkmark" size={22} color={colors.surface} /></View><View><Text style={styles.bannerTitle}>{fromLookup ? 'RECORD FOUND' : 'ANIMAL IDENTIFIED'}</Text><Text style={styles.bannerSubtitle}>{fromLookup ? 'Matched by ID lookup' : 'Simulated match · 94% illustrative'}</Text></View></View>
      <Card style={styles.resultCard}>
        <View style={styles.idHeader}><View><Text style={styles.idKicker}>MOOZZLE ID</Text><Text selectable style={styles.resultId}>{formatMoozzleId(animal.moozzle_id)}</Text></View><Pressable accessibilityRole="button" onPress={onCopy} style={styles.copyButton}><Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={19} color={colors.primary} /><Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text></Pressable></View>
        <View style={styles.summaryLine}><Pill label={animal.animal_type} tone={animal.animal_type === 'Buffalo' ? 'blue' : 'green'} /><Text style={styles.summaryText}>{animal.breed} · {animal.sex} · {animal.age_years} yrs</Text></View>
        <Text style={styles.ownerLine}><Ionicons name="person-outline" size={15} color={colors.muted} /> {animal.owner_name} · {animal.village}</Text>
        {!fromLookup && <View style={styles.matchScore}><View style={styles.scoreTop}><Text style={styles.scoreLabel}>Match Score (illustrative)</Text><Text style={styles.scoreValue}>94%</Text></View><View style={styles.scoreTrack}><View style={styles.scoreFill} /></View><Text style={styles.modelText}>Model: {MODEL_VERSION} · Replace with validated model</Text></View>}
      </Card>
      <Text style={styles.comparisonTitle}>Biometric visual comparison</Text>
      <View style={styles.comparisonRow}><ComparisonImage animal={animal} label="Captured Scan" /><ComparisonImage animal={animal} label="Enrolled Reference" /></View>
      <View style={styles.buttonRow}><PrimaryButton label="View Full Record" icon="document-text-outline" onPress={onOpenRecord} style={styles.halfButton} /><PrimaryButton label="Scan Next Animal" onPress={onNext} variant="outline" style={styles.halfButton} /></View>
    </View>
  );
}

function ComparisonImage({ animal, label }: { animal: Animal; label: string }) {
  return <View style={styles.comparisonItem}><AnimalPhoto animal={animal} size={155} /><Text style={styles.comparisonLabel}>{label}</Text><View style={styles.landmarkBadge}><Ionicons name="sparkles-outline" size={12} color={colors.blue} /><Text style={styles.landmarkText}>ridge landmarks</Text></View></View>;
}

const styles = StyleSheet.create({
  screenBody: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 20, gap: 16 },
  titleBlock: { gap: 5 },
  eyebrow: { color: colors.blue, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.1 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 29 },
  subtitle: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  qualityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qualityInstruction: { flex: 1, color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  processingCard: { gap: 20, paddingVertical: 20 },
  searchHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  radarIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.blueLight, alignItems: 'center', justifyContent: 'center' },
  processingTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  processingSubtitle: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 3 },
  resultStack: { gap: 14 },
  identifiedBanner: { borderRadius: 14, backgroundColor: colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#4CAF67', alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 16 },
  bannerSubtitle: { color: '#C4E8CE', fontFamily: Fonts.medium, fontSize: 12, marginTop: 2 },
  resultCard: { gap: 13 },
  idHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  idKicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  resultId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 25, letterSpacing: 1, fontVariant: ['tabular-nums'], marginTop: 3 },
  copyButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 10 },
  copyText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 12 },
  summaryLine: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  summaryText: { flex: 1, color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  ownerLine: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 13 },
  matchScore: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 13, gap: 6 },
  scoreTop: { flexDirection: 'row', justifyContent: 'space-between' },
  scoreLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  scoreValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 16 },
  scoreTrack: { height: 8, borderRadius: 4, backgroundColor: colors.slateLight, overflow: 'hidden' },
  scoreFill: { height: 8, width: '94%', backgroundColor: colors.accent, borderRadius: 4 },
  modelText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 10 },
  comparisonTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  comparisonRow: { flexDirection: 'row', gap: 10 },
  comparisonItem: { flex: 1, gap: 6 },
  comparisonLabel: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  landmarkBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.blueLight, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4 },
  landmarkText: { color: colors.blue, fontFamily: Fonts.medium, fontSize: 9 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  halfButton: { flex: 1, paddingHorizontal: 8 },
  firstRun: { gap: 4 },
  lookupCard: { gap: 10 },
  lookupEmpty: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  lookupRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  lookupCopy: { flex: 1, gap: 2 },
  lookupId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  lookupMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  pressed: { opacity: 0.8 },
  disclaimer: { flexDirection: 'row', gap: 7, backgroundColor: colors.warningLight, padding: 11, borderRadius: 10, alignItems: 'flex-start' },
  disclaimerText: { color: '#845A1A', flex: 1, fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16 },
});
