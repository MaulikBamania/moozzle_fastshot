// Trial fields mirror the persisted animal and API naming contract.
// biome-ignore-all lint/style/useNamingConvention: Validation payload fields use the persisted snake_case contract.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  AppScreen,
  Card,
  colors,
  OptionChip,
  PageHeader,
  PrimaryButton,
  DataGate,
  TextField,
} from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { useAppStore } from '@/store/useAppStore';
import { useBovineData } from '@/store/useBovineStore';
import { LiveValidation, ModelMatrix, SampleSizeCard } from '@/components/validation-suite';
import type { AnimalType, ValidationPayload, ValidationTrial } from '@/store/types';

interface ValidationDraft {
  location: string;
  date: string;
  breed: string;
  animalsCount: string;
  imagesPerAnimal: string;
  verificationAttempts: string;
  identificationAttempts: string;
  correctMatches: string;
  falseAcceptances: string;
  falseRejections: string;
  deviceModel: string;
}




export default function PerformanceScreen() {
  return (
    <DataGate>
      <PerformanceContent />
    </DataGate>
  );
}

function PerformanceContent() {
  const trials = useAppStore((state) => state.validationTrials);
  const { animals } = useBovineData();
  const archiveStats = useMemo(() => [
    ['Registered bovines', String(animals.length)],
    ['Cattle', String(animals.filter((item) => item.animal_type === 'Cattle').length)],
    ['Buffalo', String(animals.filter((item) => item.animal_type === 'Buffalo').length)],
    ['Enrolled templates', String(animals.filter((item) => item.biometric_status === 'Enrolled').length)],
    ['Active', String(animals.filter((item) => item.current_status === 'Active').length)],
    ['Retired', String(animals.filter((item) => item.current_status === 'Retired').length)],
  ] as const, [animals]);
  const addValidationTrial = useAppStore((state) => state.addValidationTrial);
  const [validation, setValidation] = useState<ValidationPayload | null>(null);
  const [animalType, setAnimalType] = useState<AnimalType>('Cattle');
  const [draft, setDraft] = useState<ValidationDraft>(createInitialDraft);
  const [formError, setFormError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [reportVisible, setReportVisible] = useState(false);

  const metrics = useMemo(() => {
    const verification = toNumber(draft.verificationAttempts);
    const identification = toNumber(draft.identificationAttempts);
    const correct = toNumber(draft.correctMatches);
    const falseAcceptances = toNumber(draft.falseAcceptances);
    const falseRejections = toNumber(draft.falseRejections);
    const far = verification > 0 ? (falseAcceptances / verification) * 100 : 0;
    const frr = verification > 0 ? (falseRejections / verification) * 100 : 0;
    const accuracyDenominator = verification + identification;
    const accuracy = accuracyDenominator > 0 ? (correct / accuracyDenominator) * 100 : 0;
    // Correct matches are true positives; false acceptances are false positives; false rejections are false negatives.
    const precision = correct + falseAcceptances > 0 ? (correct / (correct + falseAcceptances)) * 100 : 0;
    const recall = correct + falseRejections > 0 ? (correct / (correct + falseRejections)) * 100 : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { far, frr, accuracy, precision, recall, f1 };
  }, [draft]);

  const report = useMemo(() => {
    if (trials.length === 0) return null;
    const totals = trials.reduce((result, trial) => ({
      animals: result.animals + trial.animals_count,
      trials: result.trials + 1,
      accuracy: result.accuracy + trial.accuracy,
      far: result.far + trial.far,
      frr: result.frr + trial.frr,
    }), { animals: 0, trials: 0, accuracy: 0, far: 0, frr: 0 });
    return {
      ...totals,
      averageAccuracy: totals.accuracy / totals.trials,
      averageFar: totals.far / totals.trials,
      averageFrr: totals.frr / totals.trials,
    };
  }, [trials]);

  const handleDraftChange = useCallback((field: keyof ValidationDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFormError('');
    setSavedMessage('');
  }, []);

  const handleAnimalTypeChange = useCallback((value: AnimalType) => {
    setAnimalType(value);
    setSavedMessage('');
  }, []);

  const handleSaveTrial = useCallback(() => {
    try {
      const numericFields = [
        draft.animalsCount,
        draft.imagesPerAnimal,
        draft.verificationAttempts,
        draft.identificationAttempts,
        draft.correctMatches,
        draft.falseAcceptances,
        draft.falseRejections,
      ];
      const hasInvalidNumber = numericFields.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0);
      if (!draft.location.trim() || !draft.date.trim() || !draft.breed.trim() || !draft.deviceModel.trim() || hasInvalidNumber || Number(draft.animalsCount) === 0) {
        setFormError('Add a location, date, breed, device model, and valid non-zero animal count before saving.');
        return;
      }

      const trial: ValidationTrial = {
        id: `field-trial-${Date.now()}`,
        location: draft.location.trim(),
        date: draft.date.trim(),
        breed: draft.breed.trim(),
        animal_type: animalType,
        animals_count: Number(draft.animalsCount),
        images_per_animal: Number(draft.imagesPerAnimal),
        verification_attempts: Number(draft.verificationAttempts),
        identification_attempts: Number(draft.identificationAttempts),
        correct_matches: Number(draft.correctMatches),
        false_acceptances: Number(draft.falseAcceptances),
        false_rejections: Number(draft.falseRejections),
        far: metrics.far,
        frr: metrics.frr,
        accuracy: metrics.accuracy,
        device_model: draft.deviceModel.trim(),
        created_at: new Date().toISOString(),
      };
      addValidationTrial(trial);
      setFormError('');
      setSavedMessage(`Trial saved: ${trial.location} · ${formatPercent(trial.accuracy)} accuracy calculated from entered counts.`);
      setReportVisible(false);
    } catch (caughtError) {
      console.error('Could not save field validation trial', caughtError);
      setFormError('The field trial could not be saved locally. Please try again.');
    }
  }, [addValidationTrial, animalType, draft, metrics.accuracy, metrics.far, metrics.frr]);

  const handleGenerateReport = useCallback(() => {
    try {
      if (!report) {
        setFormError('Save at least one field trial before generating a summary report.');
        return;
      }
      setFormError('');
      setReportVisible(true);
    } catch (caughtError) {
      console.error('Could not generate validation report', caughtError);
      setFormError('The summary report could not be generated. Please try again.');
    }
  }, [report]);

  const handleBack = useCallback(() => router.back(), []);

  return (
    <AppScreen scroll>
      <PageHeader eyebrow="Biometric engine" title="Model Strategy" onBack={handleBack} />
      <View style={styles.content}>
        <Card style={styles.heroCard}>
          <View style={styles.heroIcon}><Ionicons name="analytics-outline" size={26} color={colors.primary} /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>Evidence first</Text>
            <Text style={styles.heroTitle}>Model Strategy & Field Validation</Text>
            <Text selectable style={styles.heroText}>Candidate architectures, live FAR/FRR from enrolled templates, the 99.99% research benchmark and manual field-trial entry. No accuracy figure is shown that was not measured.</Text>
          </View>
        </Card>

        <SectionHeading eyebrow="Architecture" title="Model comparison matrix" />
        <ModelMatrix measuredMs={validation?.scans.avg_ms ?? null} />

        <SectionHeading eyebrow="Live engine" title="FAR / FRR validation" />
        <LiveValidation onLoaded={setValidation} />

        <SectionHeading eyebrow="Research target" title="99.99% benchmark sample size" />
        <SampleSizeCard impostorTrials={validation ? validation.pairs.filter((pair) => pair[0] === 0).length : null} />

        <SectionHeading eyebrow="Your cloud archive" title="Archive statistics" />
        <Card style={styles.statsCard}>
          {archiveStats.map(([label, value], index) => <StatRow key={label} label={label} value={value} accent={index === 0} />)}
        </Card>

        <SectionHeading eyebrow="Section 35" title="Field validation" />
        <Card style={styles.formCard}>
          <Text style={styles.formIntro}>Record a controlled trial on representative cattle or buffalo datasets. FAR and FRR use verification attempts; Accuracy uses total verification and identification attempts.</Text>
          <DraftField label="Location" field="location" draft={draft} onChange={handleDraftChange} placeholder="e.g. Sanand Field Station" />
          <View style={styles.fieldGrid}>
            <DraftField label="Date" field="date" draft={draft} onChange={handleDraftChange} placeholder="YYYY-MM-DD" compact />
            <DraftField label="Breed" field="breed" draft={draft} onChange={handleDraftChange} placeholder="e.g. Gir" compact />
          </View>
          <Text style={styles.fieldLabel}>Bovine type</Text>
          <View style={styles.chipRow}>
            <OptionChip label="Cattle" selected={animalType === 'Cattle'} onPress={() => handleAnimalTypeChange('Cattle')} />
            <OptionChip label="Buffalo" selected={animalType === 'Buffalo'} onPress={() => handleAnimalTypeChange('Buffalo')} tone="blue" />
          </View>
          <View style={styles.fieldGrid}>
            <DraftField label="Animals count" field="animalsCount" draft={draft} onChange={handleDraftChange} keyboardType="numeric" compact />
            <DraftField label="Images per animal" field="imagesPerAnimal" draft={draft} onChange={handleDraftChange} keyboardType="numeric" compact />
          </View>
          <View style={styles.fieldGrid}>
            <DraftField label="Verification attempts" field="verificationAttempts" draft={draft} onChange={handleDraftChange} keyboardType="numeric" compact />
            <DraftField label="Identification attempts" field="identificationAttempts" draft={draft} onChange={handleDraftChange} keyboardType="numeric" compact />
          </View>
          <View style={styles.fieldGrid}>
            <DraftField label="Correct matches" field="correctMatches" draft={draft} onChange={handleDraftChange} keyboardType="numeric" compact />
            <DraftField label="False acceptances" field="falseAcceptances" draft={draft} onChange={handleDraftChange} keyboardType="numeric" compact />
          </View>
          <View style={styles.fieldGrid}>
            <DraftField label="False rejections" field="falseRejections" draft={draft} onChange={handleDraftChange} keyboardType="numeric" compact />
            <DraftField label="Device model" field="deviceModel" draft={draft} onChange={handleDraftChange} placeholder="e.g. Pixel 8" compact />
          </View>

          <View style={styles.calculatedCard}>
            <Text style={styles.calculatedTitle}>Calculated trial metrics</Text>
            <View style={styles.calculatedGrid}>
              <CalculatedMetric label="FAR" value={metrics.far} />
              <CalculatedMetric label="FRR" value={metrics.frr} />
              <CalculatedMetric label="Accuracy" value={metrics.accuracy} />
            </View>
            <View style={styles.calculatedGrid}>
              <CalculatedMetric label="Precision" value={metrics.precision} />
              <CalculatedMetric label="Recall" value={metrics.recall} />
              <CalculatedMetric label="F1 Score" value={metrics.f1} />
            </View>
          </View>
          {formError ? <Text selectable style={styles.errorText}>{formError}</Text> : null}
          {savedMessage ? <Text selectable style={styles.successText}>{savedMessage}</Text> : null}
          <PrimaryButton label="SAVE FIELD TRIAL" icon="save-outline" onPress={handleSaveTrial} />
        </Card>

        <SectionHeading eyebrow="Saved evidence" title="Validation report" />
        <Card style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <View style={styles.reportIcon}><Ionicons name="document-text-outline" size={22} color={colors.blue} /></View>
            <View style={styles.reportCopy}>
              <Text style={styles.cardTitle}>{trials.length} saved trial{trials.length === 1 ? '' : 's'}</Text>
              <Text style={styles.formIntro}>Generate an aggregate summary from locally saved field entries.</Text>
            </View>
          </View>
          <PrimaryButton label="GENERATE SUMMARY REPORT" variant="blue" icon="bar-chart-outline" onPress={handleGenerateReport} />
          {reportVisible && report ? <ReportSummary report={report} latestLocation={trials[0]?.location ?? 'Unknown'} /> : null}
        </Card>
      </View>
    </AppScreen>
  );
}

function DraftField({ label, field, draft, onChange, placeholder, keyboardType, compact = false }: { label: string; field: keyof ValidationDraft; draft: ValidationDraft; onChange: (field: keyof ValidationDraft, value: string) => void; placeholder?: string; keyboardType?: 'default' | 'numeric'; compact?: boolean }) {
  const handleChange = useCallback((value: string) => onChange(field, value), [field, onChange]);
  return <TextField style={compact ? styles.fieldGridItem : undefined} label={label} value={draft[field]} onChangeText={handleChange} placeholder={placeholder} keyboardType={keyboardType} autoCapitalize="sentences" />;
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View>;
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={styles.statRow}><Text style={[styles.statLabel, accent && styles.statLabelAccent]}>{label}</Text><Text selectable style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text></View>;
}

function CalculatedMetric({ label, value }: { label: string; value: number }) {
  return <View style={styles.calculatedMetric}><Text selectable style={styles.calculatedValue}>{formatPercent(value)}</Text><Text style={styles.calculatedLabel}>{label}</Text></View>;
}

function ReportSummary({ report, latestLocation }: { report: { animals: number; trials: number; averageAccuracy: number; averageFar: number; averageFrr: number }; latestLocation: string }) {
  return (
    <View style={styles.reportSummary}>
      <View style={styles.reportSummaryTitle}><Ionicons name="checkmark-circle" size={19} color={colors.accent} /><Text style={styles.reportReady}>Summary report generated</Text></View>
      <Text selectable style={styles.reportText}>{report.trials} trial{report.trials === 1 ? '' : 's'} across {report.animals} animals · latest location: {latestLocation}</Text>
      <View style={styles.reportMetrics}>
        <ReportMetric label="Avg accuracy" value={report.averageAccuracy} />
        <ReportMetric label="Avg FAR" value={report.averageFar} />
        <ReportMetric label="Avg FRR" value={report.averageFrr} />
      </View>
    </View>
  );
}

function ReportMetric({ label, value }: { label: string; value: number }) {
  return <View><Text selectable style={styles.reportMetricValue}>{formatPercent(value)}</Text><Text style={styles.reportMetricLabel}>{label}</Text></View>;
}

function createInitialDraft(): ValidationDraft {
  return {
    location: 'Sanand Field Station',
    date: new Date().toISOString().slice(0, 10),
    breed: 'Gir',
    animalsCount: '24',
    imagesPerAnimal: '4',
    verificationAttempts: '48',
    identificationAttempts: '72',
    correctMatches: '114',
    falseAcceptances: '1',
    falseRejections: '3',
    deviceModel: 'Pixel 8 field kit',
  };
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  heroCard: { flexDirection: 'row', gap: 12, backgroundColor: '#F1FBF5', borderColor: '#CAE8D4' },
  heroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, gap: 4 },
  heroTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 19, lineHeight: 23 },
  cardTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  heroText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  eyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase' },
  sectionHeading: { gap: 2, paddingHorizontal: 2 },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 23 },
  statsCard: { gap: 0 },
  statRow: { minHeight: 43, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 13 },
  statLabelAccent: { color: colors.text, fontFamily: Fonts.bold },
  statValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, fontVariant: ['tabular-nums'] },
  statValueAccent: { color: colors.primary, fontSize: 24 },
  benchmarkCard: { gap: 14 },
  disclaimerBox: { borderRadius: 12, backgroundColor: colors.blueLight, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  disclaimer: { flex: 1, color: '#075985', fontFamily: Fonts.semiBold, fontSize: 12, lineHeight: 17 },
  benchmarkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  benchmarkItem: { width: '31.8%', minHeight: 71, padding: 8, borderRadius: 11, backgroundColor: colors.slateLight, gap: 5 },
  benchmarkLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 10 },
  benchmarkValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 11, lineHeight: 14 },
  formCard: { gap: 14 },
  formIntro: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  fieldGrid: { flexDirection: 'row', gap: 10 },
  fieldGridItem: { flex: 1 },
  fieldLabel: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  chipRow: { flexDirection: 'row', gap: 8 },
  calculatedCard: { borderRadius: 13, backgroundColor: '#F5FAF6', borderWidth: 1, borderColor: '#D6E9DE', padding: 12, gap: 10 },
  calculatedTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13 },
  calculatedGrid: { flexDirection: 'row', gap: 8 },
  calculatedMetric: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 8, gap: 2 },
  calculatedValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 17, fontVariant: ['tabular-nums'] },
  calculatedLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 10 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  successText: { color: colors.primary, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  reportCard: { gap: 14 },
  reportHeader: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  reportIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.blueLight, alignItems: 'center', justifyContent: 'center' },
  reportCopy: { flex: 1, gap: 3 },
  reportSummary: { borderRadius: 12, backgroundColor: '#F5FAF6', borderWidth: 1, borderColor: '#D6E9DE', padding: 12, gap: 9 },
  reportSummaryTitle: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  reportReady: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 13 },
  reportText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  reportMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  reportMetricValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, fontVariant: ['tabular-nums'] },
  reportMetricLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 10 },
});
