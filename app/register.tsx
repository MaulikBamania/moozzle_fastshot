import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import {
  AppScreen,
  Card,
  colors,
  OptionChip,
  PipelineList,
  Pill,
  PrimaryButton,
  TextField,
  DataGate,
  formatMoozzleId,
} from '@/components/moozzle-ui';
import { RequireAccess } from '@/components/app-chrome';
import { DecisionBanner, ServiceUnavailablePanel, TestSessionBanner } from '@/components/biometric-decision';
import { CaptureImage, EnginePipeline, errorText, MuzzleCapture, ScoreMeter } from '@/components/biometric-ui';
import { analyzeMuzzle, logAcquisitionEvent, uploadCapture } from '@/lib/biometric/engine';
import { classifyBiometricError } from '@/lib/biometric/errors';
import { cosineSimilarity, embeddingLiteral, ENGINE_MODEL } from '@/lib/biometric/features';
import { createAnimal, generateMoozzleId, logAudit, useBovineStore, useSession, type RegisterResult } from '@/store/useBovineStore';
import { useCaptureHandoff } from '@/store/useCaptureHandoff';
import { useIsOnline } from '@/store/useConnectivity';
import type { AgeGroup, AnimalType, CaptureSource, GpsFix, MuzzleAnalysis, PipelineStage, PregnancyStatus, ProductionStatus, Sex, YesNo } from '@/store/types';
import { Fonts } from '@/constants/Typography';
import { AGE_MAX_MONTHS, AGE_MAX_YEARS, formatAge } from '@/lib/age';
import {
  ageThresholdsFor,
  breedsFor,
  computeAgeGroup,
  describeAgeGroup,
  formatCoordinate,
  formatLocalDateTime,
  isMaleOnlySpecies,
  pregnancyAllowed,
  productionAllowed,
  SPECIES_OPTIONS,
  type AgeThresholds,
} from '@/lib/demographics';
import { useGpsCapture } from '@/lib/use-gps';
import { ChoiceField, FieldError, FieldLabel, GpsCard, ReadOnlyField, RegistrationTimeCard, SocietyFields } from '@/components/register-demographics';

const MIN_FRAMES = 3;
const MAX_FRAMES = 5;
const SAVE_STEPS = ['Uploading accepted muzzle frames (private, encrypted storage)', '1:N duplicate search across every enrolled template', 'Issuing permanent 12-digit MOOZZLE ID & writing audit log'];

const SPECIES_CHOICES = SPECIES_OPTIONS.map((item) => ({ value: item.type, label: item.label }));
const YES_NO_CHOICES = [{ value: 'yes' as const, label: 'YES' }, { value: 'no' as const, label: 'NO' }];
const PRODUCTION_CHOICES = [{ value: 'DRY' as const, label: 'DRY' }, { value: 'MILK' as const, label: 'MILK' }, { value: 'NA' as const, label: 'NA' }];
const PREGNANCY_CHOICES = [{ value: 'PREGNANT' as const, label: 'PREGNANT' }, { value: 'NON-PREGNANT' as const, label: 'NON-PREGNANT' }, { value: 'NA' as const, label: 'NA' }];

type DetailField = 'species' | 'breed' | 'ageGroup' | 'dairy' | 'societyName' | 'societyCode' | 'memberCode' | 'production' | 'pregnancy' | 'gps' | 'location' | 'farm';
type DetailErrors = Partial<Record<DetailField, string>>;

function productionLockReason(type: AnimalType | null, sex: Sex, group: AgeGroup | null): string {
  if (type === 'Bull') return 'Set to NA: bulls do not produce milk.';
  if (type === 'Bullock') return 'Set to NA: a bullock is a male draught animal.';
  if (sex === 'Male') return 'Set to NA: males do not produce milk.';
  if (group === 'CALF') return 'Set to NA: calves are not in milk production.';
  return 'Set to NA: only adult females can be MILK or DRY.';
}

function pregnancyLockReason(type: AnimalType | null, sex: Sex): string {
  if (type === 'Bull') return 'Set to NA: bulls cannot be pregnant.';
  if (type === 'Bullock') return 'Set to NA: a bullock cannot be pregnant.';
  if (sex === 'Male') return 'Set to NA: males cannot be pregnant.';
  return 'Set to NA: calves cannot be pregnant.';
}

interface AcceptedFrame {
  analysis: MuzzleAnalysis;
  /** Mean cosine similarity to the frames accepted before it (consistency check). */
  consistency: number | null;
  path: string | null;
}

export default function RegisterScreen() {
  return <DataGate><RequireAccess destination="register"><RegisterContent /></RequireAccess></DataGate>;
}

function RegisterContent() {
  const session = useSession();
  const profile = useBovineStore((state) => state.profile);
  const allFarms = useBovineStore((state) => state.farms);
  const clearHandoff = useCaptureHandoff((state) => state.setFrame);
  // An accepted frame handed over from Identify ("Register New Animal") becomes frame 1.
  const [handed] = useState(() => {
    const frame = useCaptureHandoff.getState().frame;
    return frame?.embedding ? frame : null;
  });
  const online = useIsOnline();
  const profileVillage = profile?.village ?? '';
  const isFarmer = session.role === 'Farmer';
  const level = session.permissions.register_animal;
  const needsApproval = level !== 'Full' && level !== 'Scoped';
  const farmOptions = useMemo(() => {
    if (isFarmer) return [];
    if (session.role === 'Organisation Administrator') return allFarms.filter((farm) => farm.organisation_id === session.scope?.organisation_id);
    if (session.role === 'Government Officer' || session.role === 'Livestock Inspector') return allFarms.filter((farm) => session.scope?.districts.includes(farm.district));
    if (session.role === 'Super Administrator') return allFarms;
    return allFarms.filter((farm) => session.scope?.farm_ids.includes(farm.id));
  }, [allFarms, isFarmer, session.role, session.scope]);
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(farmOptions.length === 1 ? farmOptions[0].id : null);
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [step, setStep] = useState(1);
  const settings = useBovineStore((state) => state.settings);
  // Species is prefilled only from an AI-detected handoff; the breed always needs an explicit choice.
  const [animalType, setAnimalType] = useState<AnimalType | null>(handed?.detection.species === 'buffalo' ? 'Buffalo' : handed?.detection.species === 'cattle' ? 'Cattle' : null);
  const [breed, setBreed] = useState('');
  const [sex, setSex] = useState<Sex>('Female');
  const [ageYears, setAgeYears] = useState(4);
  const [ageMonths, setAgeMonths] = useState(0);
  const [dairySociety, setDairySociety] = useState<YesNo | null>(null);
  // Society details are kept while toggling YES/NO and submitted only for YES.
  const [societyName, setSocietyName] = useState('');
  const [societyCode, setSocietyCode] = useState('');
  const [memberCode, setMemberCode] = useState('');
  const [productionChoice, setProductionChoice] = useState<ProductionStatus | null>(null);
  const [pregnancyChoice, setPregnancyChoice] = useState<PregnancyStatus | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [registeredAt, setRegisteredAt] = useState<Date | null>(null);
  const gps = useGpsCapture();
  // One id per registration attempt: repeated taps, retries and sync replays resolve to the same record.
  const registrationKey = useRef({ id: Crypto.randomUUID(), moozzleId: generateMoozzleId() });
  const [stateName, setStateName] = useState('Gujarat');
  const [district, setDistrict] = useState('Ahmedabad');
  const [village, setVillage] = useState(profileVillage);
  const [owner, setOwner] = useState(isFarmer ? profile?.full_name ?? '' : '');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [farmId, setFarmId] = useState('');
  const [detailsError, setDetailsError] = useState('');
  const [frames, setFrames] = useState<AcceptedFrame[]>(() => (handed ? [{ analysis: handed, consistency: null, path: null }] : []));
  const [prefilled, setPrefilled] = useState(!!handed);
  const [feedback, setFeedback] = useState<MuzzleAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [captureError, setCaptureError] = useState('');
  const [pendingUri, setPendingUri] = useState<{ uri: string; source: CaptureSource } | null>(null);
  const [captureService, setCaptureService] = useState(false);
  // Capture attempts in this enrolment session, for Failure-to-Enrol reporting.
  const attempts = useRef({ total: 0, rejected: 0 });
  const [saveStep, setSaveStep] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [registered, setRegistered] = useState<RegisterResult | null>(null);
  const [showCancel, setShowCancel] = useState(false);

  const breeds = breedsFor(animalType);
  const thresholds = useMemo(() => ageThresholdsFor(settings, animalType), [animalType, settings]);
  const ageGroup = computeAgeGroup(ageYears, ageMonths, thresholds);
  const canProduce = productionAllowed(animalType, sex, ageGroup);
  const canBePregnant = pregnancyAllowed(animalType, sex, ageGroup);
  // Ineligible animals are enforced to NA; eligible ones need an explicit choice (never auto-classified).
  const productionStatus: ProductionStatus | null = canProduce ? productionChoice : ageGroup && animalType ? 'NA' : null;
  const pregnancyStatus: PregnancyStatus | null = canBePregnant ? pregnancyChoice : ageGroup && animalType ? 'NA' : null;

  const detailErrors = useMemo<DetailErrors>(() => {
    const errors: DetailErrors = {};
    if (!animalType) errors.species = 'Choose the bovine species.';
    if (animalType && !breed) errors.breed = 'Choose a breed.';
    if (animalType && !thresholds) errors.ageGroup = 'Age group thresholds are not configured for this species. Ask your administrator to set them in Platform Settings.';
    if (!dairySociety) errors.dairy = 'Answer YES or NO.';
    if (dairySociety === 'yes') {
      if (!societyName.trim()) errors.societyName = 'Society name is required.';
      if (!societyCode.trim()) errors.societyCode = 'Society code is required.';
      if (!memberCode.trim()) errors.memberCode = 'Member code is required.';
    }
    if (animalType && ageGroup && !productionStatus) errors.production = 'Choose Status I (DRY, MILK or NA).';
    if (animalType && ageGroup && !pregnancyStatus) errors.pregnancy = 'Choose Status II (PREGNANT, NON-PREGNANT or NA).';
    if (!gps.fix) errors.gps = 'Capture the GPS location to continue.';
    if (!owner.trim() || !village.trim() || !district.trim() || !stateName.trim()) errors.location = 'Owner name, village, district and state are required.';
    if (!isFarmer && farmOptions.length > 0 && !selectedFarmId) errors.farm = 'Choose the assigned farm this animal belongs to.';
    return errors;
  }, [ageGroup, animalType, breed, dairySociety, district, farmOptions.length, gps.fix, isFarmer, memberCode, owner, pregnancyStatus, productionStatus, selectedFarmId, societyCode, societyName, stateName, thresholds, village]);

  useEffect(() => {
    clearHandoff(null);
  }, [clearHandoff]);

  const handleTypeChange = useCallback((value: AnimalType) => {
    setAnimalType(value);
    // Keep the breed only when it is valid for the new species; never assign one automatically.
    setBreed((current) => (breedsFor(value).includes(current) ? current : ''));
    if (isMaleOnlySpecies(value)) setSex('Male');
  }, []);

  const handleFrame = useCallback(async (uri: string, source: CaptureSource) => {
    if (frames.length >= MAX_FRAMES) return;
    setCaptureError('');
    setCaptureService(false);
    setPendingUri({ uri, source });
    setAnalyzing(true);
    try {
      const analysis = await analyzeMuzzle(uri, setStage, source);
      setPendingUri(null);
      attempts.current.total += 1;
      if (!analysis.embedding) {
        attempts.current.rejected += 1;
        setFeedback(analysis);
        void logAcquisitionEvent({ operation: 'enrol', eventType: 'failure_to_acquire', analysis, framesAttempted: 1, framesAccepted: frames.length });
        void logAudit('biometric.capture', '', `Enrolment frame rejected (not enrolled): ${analysis.status}`, 'failed');
        return;
      }
      const embedding = analysis.embedding;
      const sims = frames.map((frame) => cosineSimilarity(frame.analysis.embedding ?? [], embedding));
      if (sims.some((value) => value > 0.9995)) {
        setFeedback({ ...analysis, status: 'PATTERN NOT CLEAR — RETAKE', reasons: [], hint: 'This frame is identical to one already accepted. Capture a new frame with a slightly different angle.', embedding: null });
        return;
      }
      const consistency = sims.length ? sims.reduce((sum, value) => sum + value, 0) / sims.length : null;
      setFeedback(analysis);
      setFrames((current) => [...current, { analysis, consistency, path: null }].slice(0, MAX_FRAMES));
    } catch (caught) {
      console.error('Enrolment frame analysis failed', caught);
      const service = classifyBiometricError(caught) === 'service_unavailable';
      setCaptureService(service);
      if (service) void logAcquisitionEvent({ operation: 'enrol', eventType: 'service_unavailable', reasonCode: 'service_unavailable', source });
      setCaptureError(errorText(caught, 'AI muzzle analysis failed. Check your connection and retry.'));
    } finally {
      setAnalyzing(false);
      setStage(null);
    }
  }, [frames]);

  /** An enrolment abandoned without the minimum accepted frames after quality rejections is a Failure to Enrol. */
  const reportFailureToEnrol = useCallback(() => {
    if (step === 4 || frames.length >= MIN_FRAMES || attempts.current.rejected === 0) return;
    void logAcquisitionEvent({ operation: 'enrol', eventType: 'failure_to_enrol', reasonCode: 'insufficient_quality_frames', framesAttempted: attempts.current.total, framesAccepted: frames.length, analysis: feedback });
    attempts.current = { total: 0, rejected: 0 };
  }, [feedback, frames.length, step]);

  const removeFrame = useCallback((index: number) => {
    setFrames((current) => current.filter((_, i) => i !== index));
  }, []);

  const chooseFarm = useCallback((id: string) => {
    setSelectedFarmId(id);
    const farm = allFarms.find((item) => item.id === id);
    if (farm) {
      setVillage(farm.village);
      setDistrict(farm.district);
      setStateName(farm.state);
      setFarmId(farm.name);
    }
  }, [allFarms]);
  const goToCapture = useCallback(() => {
    const count = Object.keys(detailErrors).length;
    if (count > 0) {
      setShowErrors(true);
      setDetailsError(detailErrors.gps && count === 1 ? 'GPS location is compulsory. Capture it before continuing.' : `Complete the ${count} highlighted ${count === 1 ? 'field' : 'fields'} before continuing.`);
      return;
    }
    setDetailsError('');
    setStep(2);
  }, [detailErrors]);
  const goToProcessing = useCallback(() => {
    if (frames.length >= MIN_FRAMES) {
      setSaveStep(-1);
      setSaveError('');
      setStep(3);
    }
  }, [frames.length]);

  const handleComplete = useCallback(async (duplicateReviewNote?: string) => {
    if (saving || frames.length < MIN_FRAMES) return;
    const fix = gps.fix;
    if (!animalType || !ageGroup || !productionStatus || !pregnancyStatus || !dairySociety || !fix || Object.keys(detailErrors).length > 0) {
      setSaveError('Some Step 1 details are missing or the GPS location is no longer available. Go back to Details, complete them and capture GPS.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const submittedAt = new Date();
    setRegisteredAt(submittedAt);
    try {
      setSaveStep(0);
      const uploaded = [...frames];
      for (let i = 0; i < uploaded.length; i += 1) {
        if (!uploaded[i].path) uploaded[i] = { ...uploaded[i], path: await uploadCapture(uploaded[i].analysis) };
      }
      setFrames(uploaded);
      setSaveStep(1);
      const scores = uploaded.map((frame) => frame.analysis.qualityScore);
      const result = await createAnimal({
        registrationId: registrationKey.current.id,
        provisionalMoozzleId: registrationKey.current.moozzleId,
        animalType,
        breed,
        sex,
        ageYears,
        ageMonths,
        ageGroup,
        productionStatus,
        pregnancyStatus,
        dairySociety,
        societyName,
        societyCode,
        memberCode,
        gps: fix,
        registeredAt: submittedAt,
        ownerName: owner,
        ownerPhone,
        farmId: selectedFarmId,
        farmName: farmId,
        village,
        district,
        state: stateName,
        capturedImages: uploaded.length,
        qualityScore: Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3)),
        embeddings: uploaded.map((frame) => embeddingLiteral(frame.analysis.embedding ?? [])),
        imagePaths: uploaded.map((frame) => frame.path ?? ''),
        qualityScores: scores,
        qualityMetrics: uploaded.flatMap((frame) => (frame.analysis.metrics ? [frame.analysis.metrics] : [])),
        saveAsDraft,
        duplicateReviewNote,
      });
      setSaveStep(result.blocked || result.reviewRequired ? -1 : 3);
      setRegistered(result);
      if (!result.blocked && !result.reviewRequired) setStep(4);
    } catch (caught) {
      console.error('Could not complete animal registration', caught);
      setSaveError(errorText(caught, 'The new animal could not be saved. Please retry.'));
      setSaveStep(-1);
    } finally {
      setSaving(false);
    }
  }, [ageGroup, ageMonths, ageYears, animalType, breed, dairySociety, detailErrors, district, farmId, frames, gps.fix, memberCode, owner, ownerPhone, pregnancyStatus, productionStatus, saveAsDraft, saving, selectedFarmId, sex, societyCode, societyName, stateName, village]);

  const resetWizard = useCallback(() => {
    registrationKey.current = { id: Crypto.randomUUID(), moozzleId: generateMoozzleId() };
    attempts.current = { total: 0, rejected: 0 };
    setRegisteredAt(null);
    setShowErrors(false);
    setStep(1);
    setFrames([]);
    setFeedback(null);
    setPrefilled(false);
    setSaveStep(-1);
    setRegistered(null);
    setSaveError('');
  }, []);
  const handleCancel = useCallback(() => setShowCancel(false), []);

  return (
    <AppScreen>
      <View style={styles.pageBody}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel enrolment" onPress={() => setShowCancel(true)} hitSlop={6} style={styles.cancelButton}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text numberOfLines={1} style={styles.cancelText}>Cancel Enrolment</Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.topTitle}>Register Animal</Text>
        </View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
          <WizardStepper step={step} />
          <TestSessionBanner />
          {step === 1 && <DetailsStep demographics={{ thresholds, ageGroup, canProduce, canBePregnant, productionStatus, pregnancyStatus, dairySociety, societyName, societyCode, memberCode, onDairy: setDairySociety, onSocietyName: setSocietyName, onSocietyCode: setSocietyCode, onMemberCode: setMemberCode, onProduction: setProductionChoice, onPregnancy: setPregnancyChoice }} errors={showErrors ? detailErrors : {}} gps={gps} animalType={animalType} breed={breed} sex={sex} ageYears={ageYears} ageMonths={ageMonths} stateName={stateName} district={district} village={village} owner={owner} ownerPhone={ownerPhone} farmId={farmId} breeds={breeds} farmOptions={farmOptions.map((farm) => ({ id: farm.id, label: `${farm.name} · ${farm.village}` }))} selectedFarmId={selectedFarmId} onFarm={chooseFarm} isFarmer={isFarmer} error={detailsError} onType={handleTypeChange} onBreed={setBreed} onSex={setSex} onAgeYears={setAgeYears} onAgeMonths={setAgeMonths} onState={setStateName} onDistrict={setDistrict} onVillage={setVillage} onOwner={setOwner} onOwnerPhone={setOwnerPhone} onFarmId={setFarmId} onNext={goToCapture} />}
          {step === 2 && (
            <CaptureStep
              frames={frames}
              prefilled={prefilled}
              online={online}
              feedback={feedback}
              analyzing={analyzing}
              stage={stage}
              error={captureError}
              canRetry={!!pendingUri}
              serviceUnavailable={captureService}
              onRetry={() => { if (pendingUri) void handleFrame(pendingUri.uri, pendingUri.source); }}
              onFrame={(uri, source) => void handleFrame(uri, source)}
              onRemove={removeFrame}
              onBack={() => setStep(1)}
              onNext={goToProcessing}
            />
          )}
          {step === 3 && <ProcessingStep frames={frames.length} probeUri={frames[0]?.analysis.cropUri ?? frames[0]?.analysis.imageUri ?? null} activeStep={saveStep} saving={saving} saveError={saveError} needsApproval={needsApproval} saveAsDraft={saveAsDraft} blocked={registered?.blocked ? registered : null} reviewRequired={registered?.reviewRequired ? registered : null} onDraft={setSaveAsDraft} onBack={() => { setRegistered(null); setStep(2); }} onComplete={(note) => void handleComplete(note)} onExit={() => router.replace('/(tabs)')} />}
          {step === 4 && registered && animalType && <SuccessStep result={registered} summary={{ animalType, breed, sex, ageYears, ageMonths, ageGroup, productionStatus, pregnancyStatus, dairySociety, village, stateName, captures: frames.length, gps: gps.fix, registeredAt }} cropUri={frames[0]?.analysis.cropUri ?? null} isFarmer={isFarmer} onProfile={() => router.push(`/animal/${registered.moozzleId}`)} onIdentify={() => router.replace('/(tabs)/identify')} onRegisterAnother={resetWizard} />}
        </ScrollView>
      </View>
      <Modal visible={showCancel} transparent animationType="fade" onRequestClose={() => setShowCancel(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.modalIcon}><Ionicons name="warning-outline" size={24} color={colors.warning} /></View>
            <Text style={styles.modalTitle}>Cancel enrolment?</Text>
            <Text style={styles.modalText}>Your captured frames and animal details will be discarded.</Text>
            <View style={styles.modalActions}>
              <PrimaryButton label="Keep Working" onPress={handleCancel} variant="outline" style={styles.modalAction} />
              <PrimaryButton label="Cancel Enrolment" onPress={() => { setShowCancel(false); reportFailureToEnrol(); router.back(); }} variant="danger" style={styles.modalAction} />
            </View>
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}

function WizardStepper({ step }: { step: number }) {
  const labels = ['Details', 'Capture', 'Process', 'Assigned'];
  return (
    <View style={styles.stepper}>
      {labels.map((label, index) => {
        const active = index + 1 <= step;
        return (
          <View style={styles.stepItem} key={label}>
            <View style={[styles.stepCircle, active && styles.stepCircleActive]}><Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{index + 1}</Text></View>
            <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
            {index < labels.length - 1 && <View style={[styles.stepLine, index + 1 < step && styles.stepLineActive]} />}
          </View>
        );
      })}
    </View>
  );
}

interface DemographicsState {
  thresholds: AgeThresholds | null;
  ageGroup: AgeGroup | null;
  canProduce: boolean;
  canBePregnant: boolean;
  productionStatus: ProductionStatus | null;
  pregnancyStatus: PregnancyStatus | null;
  dairySociety: YesNo | null;
  societyName: string;
  societyCode: string;
  memberCode: string;
  onDairy: (value: YesNo) => void;
  onSocietyName: (value: string) => void;
  onSocietyCode: (value: string) => void;
  onMemberCode: (value: string) => void;
  onProduction: (value: ProductionStatus) => void;
  onPregnancy: (value: PregnancyStatus) => void;
}

interface DetailsProps {
  demographics: DemographicsState;
  errors: DetailErrors;
  gps: ReturnType<typeof useGpsCapture>;
  animalType: AnimalType | null;
  breed: string;
  sex: Sex;
  ageYears: number;
  ageMonths: number;
  stateName: string;
  district: string;
  village: string;
  owner: string;
  ownerPhone: string;
  farmId: string;
  farmOptions: { id: string; label: string }[];
  selectedFarmId: string | null;
  onFarm: (id: string) => void;
  isFarmer: boolean;
  error: string;
  breeds: string[];
  onType: (value: AnimalType) => void;
  onBreed: (value: string) => void;
  onSex: (value: Sex) => void;
  onAgeYears: (value: number) => void;
  onAgeMonths: (value: number) => void;
  onState: (value: string) => void;
  onDistrict: (value: string) => void;
  onVillage: (value: string) => void;
  onOwner: (value: string) => void;
  onOwnerPhone: (value: string) => void;
  onFarmId: (value: string) => void;
  onNext: () => void;
}

function DetailsStep(props: DetailsProps) {
  const { demographics: d, errors, gps } = props;
  const maleOnly = isMaleOnlySpecies(props.animalType);
  const sexHint = props.animalType === 'Bull' ? 'A bull is always male' : props.animalType === 'Bullock' ? 'A bullock is always male' : undefined;
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 1 OF 4</Text><Text style={styles.pageTitle}>Animal Demographics</Text><Text style={styles.pageDescription}>Set the identity details before capturing the muzzle pattern. Fields marked * are mandatory.</Text></View>
      <Card style={styles.formCard}>
        {/* 1. Bovine species */}
        <ChoiceField label="Bovine Species" options={SPECIES_CHOICES} value={props.animalType} onChange={props.onType} error={errors.species} />
        {/* 2. Breed (existing, species-specific) */}
        <View style={styles.fieldBlock}>
          <FieldLabel label="Breed" hint={props.animalType ? undefined : 'Choose the bovine species first'} />
          {props.breeds.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalOptions} contentContainerStyle={styles.horizontalOptionContent}>
              {props.breeds.map((item) => <OptionChip key={item} label={item} selected={props.breed === item} onPress={() => props.onBreed(item)} />)}
            </ScrollView>
          ) : null}
          <FieldError message={errors.breed} />
        </View>
        {/* Existing sex field — needed for the Status I / II rules */}
        <View style={styles.fieldBlock}>
          <FieldLabel label="Sex" hint={sexHint} />
          <View style={styles.optionRow}><OptionChip label="Female" selected={props.sex === 'Female'} onPress={() => props.onSex('Female')} disabled={maleOnly} /><OptionChip label="Male" selected={props.sex === 'Male'} onPress={() => props.onSex('Male')} /></View>
        </View>
        {/* 3. Age (existing years + months) */}
        <View style={styles.ageBlock}>
          <View style={styles.ageHeader}>
            <FieldLabel label="Approximate age" />
            <Text selectable style={styles.ageValue} numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">{formatAge(props.ageYears, props.ageMonths)}</Text>
          </View>
          <AgeStepper label="Years" unit={props.ageYears === 1 ? 'year' : 'years'} value={props.ageYears} max={AGE_MAX_YEARS} onChange={props.onAgeYears} />
          <AgeStepper label="Months" unit={props.ageMonths === 1 ? 'month' : 'months'} value={props.ageMonths} max={AGE_MAX_MONTHS} onChange={props.onAgeMonths} />
        </View>
        {/* 4. Age group (derived, read-only) */}
        <ReadOnlyField
          label="Age Group"
          icon="calendar-outline"
          value={d.ageGroup ?? (props.animalType ? 'Not available' : 'Choose species first')}
          caption={d.ageGroup && d.thresholds ? describeAgeGroup(d.ageGroup, d.thresholds) : undefined}
          error={errors.ageGroup}
        />
      </Card>
      <Card style={styles.formCard}>
        {/* 5–8. Dairy society */}
        <ChoiceField label="Are you giving milk in a dairy society?" options={YES_NO_CHOICES} value={d.dairySociety} onChange={d.onDairy} error={errors.dairy} />
        {d.dairySociety === 'yes' ? (
          <SocietyFields
            name={d.societyName}
            code={d.societyCode}
            member={d.memberCode}
            onName={d.onSocietyName}
            onCode={d.onSocietyCode}
            onMember={d.onMemberCode}
            errors={{ name: errors.societyName, code: errors.societyCode, member: errors.memberCode }}
          />
        ) : null}
        {/* 9. Status I */}
        <ChoiceField
          label="Status I — Production"
          hint="MILK: producing milk now · DRY: dairy animal not producing now · NA: not applicable"
          options={PRODUCTION_CHOICES}
          value={d.productionStatus}
          onChange={d.onProduction}
          lockedTo={props.animalType && d.ageGroup && !d.canProduce ? 'NA' : undefined}
          lockedReason={productionLockReason(props.animalType, props.sex, d.ageGroup)}
          error={errors.production}
          tone="blue"
        />
        {/* 10. Status II */}
        <ChoiceField
          label="Status II — Pregnancy"
          hint="PREGNANT: confirmed pregnant · NON-PREGNANT: confirmed not pregnant · NA: not applicable"
          options={PREGNANCY_CHOICES}
          value={d.pregnancyStatus}
          onChange={d.onPregnancy}
          lockedTo={props.animalType && d.ageGroup && !d.canBePregnant ? 'NA' : undefined}
          lockedReason={pregnancyLockReason(props.animalType, props.sex)}
          error={errors.pregnancy}
          tone="blue"
        />
      </Card>
      <Card style={styles.formCard}>
        {/* 11. Registration date & time */}
        <RegistrationTimeCard />
        {/* 12. GPS */}
        <GpsCard status={gps.status} fix={gps.fix} error={gps.error} onCapture={() => void gps.capture()} onOpenSettings={() => void gps.openSettings()} canOpenSettings={process.env.EXPO_OS !== 'web'} showRequired={!!errors.gps} />
      </Card>
      <Card style={styles.formCard}>
        <Text style={styles.formSectionTitle}>Location & ownership</Text>
        {props.farmOptions.length > 0 ? (
          <>
            <Text style={styles.pageDescription}>Assigned farm (only farms in your authorised scope)</Text>
            <View style={styles.farmChips}>{props.farmOptions.map((farm) => <OptionChip key={farm.id} label={farm.label} selected={props.selectedFarmId === farm.id} onPress={() => props.onFarm(farm.id)} />)}</View>
            <FieldError message={errors.farm} />
          </>
        ) : null}
        {props.isFarmer ? <Text style={styles.pageDescription}>This animal will be linked to your account and sent for verification.</Text> : null}
        <View style={styles.fieldGrid}><TextField label="State" value={props.stateName} onChangeText={props.onState} /><TextField label="District" value={props.district} onChangeText={props.onDistrict} /><TextField label="Village" value={props.village} onChangeText={props.onVillage} /><TextField label="Owner name" value={props.owner} onChangeText={props.onOwner} placeholder="Farmer's full name" /><TextField label="Owner phone (optional)" value={props.ownerPhone} onChangeText={props.onOwnerPhone} keyboardType="phone-pad" placeholder="+91 98765 43210" />{props.farmOptions.length === 0 ? <TextField label="Farm name / ID (optional)" value={props.farmId} onChangeText={props.onFarmId} placeholder="FARM-GJ-044" /> : null}</View>
        <FieldError message={errors.location} />
      </Card>
      {props.error ? <View style={styles.inlineError}><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text selectable style={styles.inlineErrorText}>{props.error}</Text></View> : null}
      <PrimaryButton label="Next: Capture Muzzle Pattern" icon="arrow-forward" onPress={props.onNext} />
      {!gps.fix ? <Text style={styles.gateNote}>GPS location is compulsory — the next step unlocks once it is captured.</Text> : null}
    </View>
  );
}

interface CaptureStepProps {
  frames: AcceptedFrame[];
  prefilled: boolean;
  online: boolean;
  feedback: MuzzleAnalysis | null;
  analyzing: boolean;
  stage: PipelineStage | null;
  error: string;
  canRetry: boolean;
  serviceUnavailable: boolean;
  onRetry: () => void;
  onFrame: (uri: string, source: CaptureSource) => void;
  onRemove: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
}

function CaptureStep(props: CaptureStepProps) {
  const { frames } = props;
  const full = frames.length >= MAX_FRAMES;
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 2 OF 4</Text><Text style={styles.pageTitle}>Capture Muzzle</Text><Text style={styles.pageDescription}>Capture {MIN_FRAMES}–{MAX_FRAMES} high-quality frames of the same animal. Each passes the same quality pre-check and preprocessing used for identification and verification; rejected frames are never enrolled.</Text></View>
      {props.prefilled ? <View style={styles.infoBox}><Ionicons name="link-outline" size={17} color={colors.blue} /><Text style={styles.infoText}>Frame 1 was carried over from your Identify scan (no registered match).</Text></View> : null}
      {!props.online ? <View style={styles.inlineError}><Ionicons name="cloud-offline-outline" size={17} color={colors.danger} /><Text style={styles.inlineErrorText}>Muzzle analysis needs a connection to the AI Gateway. Reconnect to capture frames.</Text></View> : null}
      <MuzzleCapture onFrame={props.onFrame} busy={props.analyzing} feedback={props.feedback} captureLabel={full ? 'Frames Complete' : `Capture Frame ${frames.length + 1}`} disabled={full || !props.online} />
      {props.analyzing ? <Card style={styles.processingCard}><EnginePipeline stage={props.stage} includeSearch={false} /></Card> : null}
      {props.error && props.serviceUnavailable ? <ServiceUnavailablePanel message={props.error} onRetry={props.canRetry && props.online ? props.onRetry : undefined} /> : null}
      {props.error && !props.serviceUnavailable ? <View style={styles.inlineError}><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text selectable style={styles.inlineErrorText}>{props.error}</Text>{props.canRetry ? <PrimaryButton label="Retry" variant="outline" onPress={props.onRetry} style={styles.retryButton} /> : null}</View> : null}
      <Card style={styles.reelCard}>
        <View style={styles.reelHeader}><Text style={styles.formSectionTitle}>Accepted muzzle frames</Text><Text style={styles.captureCounter}>{frames.length} / {MAX_FRAMES}</Text></View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(frames.length / MAX_FRAMES) * 100}%` }, frames.length >= MIN_FRAMES && styles.progressDone]} /></View>
        <View style={styles.thumbnailRow}>
          {frames.map((frame, index) => (
            <View style={styles.thumbnailWrap} key={frame.analysis.imageUri}>
              <CaptureImage uri={frame.analysis.cropUri ?? frame.analysis.imageUri} label={`#${index + 1}`} size={60} />
              <Text style={styles.qualityText}>Q {Math.round(frame.analysis.qualityScore * 100)}%</Text>
              {frame.consistency !== null ? <Text style={[styles.consistency, frame.consistency < 0.35 && styles.consistencyLow]}>sim {frame.consistency.toFixed(2)}</Text> : <Text style={styles.consistency}>reference</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove frame ${index + 1}`} onPress={() => props.onRemove(index)} style={styles.removeFrame}><Ionicons name="close" size={14} color={colors.surface} /></Pressable>
            </View>
          ))}
          {frames.length === 0 && <Text style={styles.reelEmpty}>Accepted frames appear here with their quality score and similarity to earlier frames.</Text>}
        </View>
        {frames.some((frame) => frame.consistency !== null && frame.consistency < 0.35) ? <Text style={styles.warnText}>A frame differs strongly from the others. Make sure every frame shows the same animal; remove it if not.</Text> : null}
      </Card>
      <View style={styles.buttonRow}><PrimaryButton label="Back" onPress={props.onBack} variant="outline" style={styles.halfButton} /><PrimaryButton label={frames.length < MIN_FRAMES ? `Need ${MIN_FRAMES - frames.length} more` : 'Run Duplicate Check'} icon="arrow-forward" onPress={props.onNext} disabled={frames.length < MIN_FRAMES || props.analyzing} style={styles.halfButton} /></View>
    </View>
  );
}

interface ProcessingProps {
  frames: number;
  probeUri: string | null;
  activeStep: number;
  saving: boolean;
  saveError: string;
  needsApproval: boolean;
  saveAsDraft: boolean;
  blocked: RegisterResult | null;
  reviewRequired: RegisterResult | null;
  onDraft: (value: boolean) => void;
  onBack: () => void;
  onComplete: (duplicateReviewNote?: string) => void;
  onExit: () => void;
}

function ProcessingStep(props: ProcessingProps) {
  const settings = useBovineStore((state) => state.settings);
  const decided = props.blocked ?? props.reviewRequired;
  const matchT = decided?.matchThreshold ?? Number(settings.find((item) => item.key === 'match_threshold')?.value ?? 0.85);
  const reviewT = decided?.reviewThreshold ?? Number(settings.find((item) => item.key === 'review_threshold')?.value ?? 0.7);
  if (props.reviewRequired) {
    return <DuplicateReviewStep result={props.reviewRequired} probeUri={props.probeUri} matchT={matchT} reviewT={reviewT} saving={props.saving} saveError={props.saveError} onSubmit={(note) => props.onComplete(note)} onBack={props.onBack} onExit={props.onExit} />;
  }
  if (props.blocked) {
    const match = props.blocked.match;
    return (
      <View style={styles.stepContent}>
        <View style={styles.blockedCard}>
          <View style={styles.blockedIcon}><Ionicons name="ban-outline" size={30} color={colors.surface} /></View>
          <Text style={styles.blockedTitle}>ANIMAL ALREADY REGISTERED</Text>
          <Text style={styles.blockedText}>The 1:N duplicate search found this muzzle among {props.blocked.templatesSearched ?? 0} enrolled templates. No second MOOZZLE ID was issued and the attempt is in the audit trail.</Text>
          <Text style={styles.successKicker}>EXISTING MOOZZLE ID</Text>
          <Text selectable style={styles.successId}>{match?.in_scope ? formatMoozzleId(match.moozzle_id) : match?.moozzle_id ?? '—'}</Text>
          {!match?.in_scope ? <Text style={styles.blockedText}>Registered outside your authorised scope; details are withheld.</Text> : null}
        </View>
        {match ? (
          <Card style={styles.formCard}>
            <View style={styles.compareRow}><CaptureImage path={match.in_scope ? match.reference_image_path : null} label="REGISTERED" size={110} /><View style={styles.flex}><Text style={styles.formSectionTitle}>{match.in_scope ? `${match.breed} · ${match.farm_name || match.village}` : 'Existing registration'}</Text></View></View>
            <ScoreMeter score={props.blocked.score ?? match.score} upper={matchT} lower={reviewT} />
          </Card>
        ) : null}
        {match?.in_scope ? <PrimaryButton label="VIEW EXISTING RECORD" icon="document-text-outline" onPress={() => router.push(`/animal/${match.moozzle_id}`)} /> : null}
        <View style={styles.buttonRow}><PrimaryButton label="Recapture Frames" variant="outline" onPress={props.onBack} style={styles.halfButton} /><PrimaryButton label="Exit" variant="soft" onPress={props.onExit} style={styles.halfButton} /></View>
      </View>
    );
  }
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 3 OF 4</Text><Text style={styles.pageTitle}>Duplicate Check</Text><Text style={styles.pageDescription}>{props.frames} embeddings are searched against every enrolled template on the server before any ID is issued. A confirmed match blocks registration; a possible match is held for your review and no ID is issued automatically.</Text></View>
      <Card style={styles.processingCard}><PipelineList steps={SAVE_STEPS} activeStep={props.activeStep} /></Card>
      <Card style={styles.formCard}>
        <Text style={styles.formSectionTitle}>Save as</Text>
        <View style={styles.optionRow}>
          <OptionChip label={props.needsApproval ? 'Submit for approval' : 'Enrol now'} selected={!props.saveAsDraft} onPress={() => props.onDraft(false)} />
          <OptionChip label="Save draft" selected={props.saveAsDraft} onPress={() => props.onDraft(true)} tone="blue" />
        </View>
        <Text style={styles.pageDescription}>{props.saveAsDraft ? 'Drafts stay private to you until submitted. The duplicate check still runs.' : props.needsApproval ? 'Your role’s registrations are reviewed by an authorised approver.' : 'Your role can enrol directly within your authorised scope.'}</Text>
      </Card>
      <View style={styles.buttonRow}><PrimaryButton label="Back" onPress={props.onBack} variant="outline" style={styles.halfButton} disabled={props.saving} /><PrimaryButton label={props.saving ? 'Checking…' : props.saveError ? 'Retry' : 'Check & Register'} icon="shield-checkmark-outline" onPress={() => props.onComplete()} disabled={props.saving} style={styles.halfButton} /></View>
      {props.saveError ? <View style={styles.inlineError}><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text selectable style={styles.inlineErrorText}>{props.saveError}</Text></View> : null}
    </View>
  );
}

/** Possible duplicate: nothing is issued until the operator compares the muzzles and explicitly submits it for review. */
function DuplicateReviewStep({ result, probeUri, matchT, reviewT, saving, saveError, onSubmit, onBack, onExit }: { result: RegisterResult; probeUri: string | null; matchT: number; reviewT: number; saving: boolean; saveError: string; onSubmit: (note: string) => void; onBack: () => void; onExit: () => void }) {
  const [note, setNote] = useState('');
  const match = result.match;
  const valid = note.trim().length >= 10;
  return (
    <View style={styles.stepContent}>
      <DecisionBanner decision="REVIEW_REQUIRED" subtitle={`POSSIBLE DUPLICATE · similarity ${result.score?.toFixed(3) ?? '—'} across ${result.templatesSearched ?? 0} templates. No MOOZZLE ID has been issued.`} />
      <Card style={styles.formCard}>
        <Text style={styles.formSectionTitle}>Compare with the existing enrolment</Text>
        <View style={styles.compareRow}>
          <CaptureImage uri={probeUri} label="THIS ANIMAL" size={120} />
          <Ionicons name="git-compare-outline" size={20} color={colors.muted} />
          <CaptureImage path={match?.in_scope ? match.reference_image_path : null} label="ENROLLED" size={120} />
        </View>
        <Text style={styles.pageDescription}>{match?.in_scope ? `Possible match: ${formatMoozzleId(match.moozzle_id)} · ${match.breed ?? ''} · ${match.farm_name || match.village || ''}` : `Possible match: ${match?.moozzle_id ?? 'an existing animal'} (outside your scope; details withheld).`}</Text>
        <ScoreMeter score={result.score ?? match?.score ?? 0} upper={matchT} lower={reviewT} upperLabel="Duplicate" />
        <Text style={styles.pageDescription}>If this is the same animal, do not register it again{match?.in_scope ? ' — open the existing record' : ''}. If you are sure it is a different animal, submit it for duplicate review: it is saved as Pending Review and an authorised reviewer must approve it before its ID is active. Config v{result.configVersion ?? '—'}.</Text>
      </Card>
      {match?.in_scope ? <PrimaryButton label="OPEN EXISTING RECORD" icon="document-text-outline" variant="outline" onPress={() => router.push(`/animal/${match.moozzle_id}`)} /> : null}
      <View style={styles.buttonRow}><PrimaryButton label="Recapture Frames" icon="camera-outline" variant="outline" onPress={onBack} style={styles.halfButton} disabled={saving} /><PrimaryButton label="Cancel Enrolment" variant="soft" onPress={onExit} style={styles.halfButton} disabled={saving} /></View>
      <Card style={styles.formCard}>
        <Text style={styles.formSectionTitle}>Submit for duplicate review</Text>
        <TextField label="Why is this a different animal? (required)" value={note} onChangeText={setNote} placeholder="e.g. different ear tag, colour pattern, owner" multiline />
        {!valid && note.length > 0 ? <Text style={styles.gateNote}>At least 10 characters.</Text> : null}
        <PrimaryButton label={saving ? 'Submitting…' : 'Submit for Duplicate Review'} icon="people-outline" variant="blue" onPress={() => onSubmit(note.trim())} disabled={!valid || saving} />
      </Card>
      {saveError ? <View style={styles.inlineError}><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text selectable style={styles.inlineErrorText}>{saveError}</Text></View> : null}
    </View>
  );
}

interface SuccessSummary {
  animalType: AnimalType;
  breed: string;
  sex: Sex;
  ageYears: number;
  ageMonths: number;
  ageGroup: AgeGroup | null;
  productionStatus: ProductionStatus | null;
  pregnancyStatus: PregnancyStatus | null;
  dairySociety: YesNo | null;
  village: string;
  stateName: string;
  captures: number;
  gps: GpsFix | null;
  registeredAt: Date | null;
}

function SuccessStep({ result, summary, cropUri, isFarmer, onProfile, onIdentify, onRegisterAnother }: { result: RegisterResult; summary: SuccessSummary; cropUri: string | null; isFarmer: boolean; onProfile: () => void; onIdentify: () => void; onRegisterAnother: () => void }) {
  const queued = result.queued;
  const statusLabel = queued ? 'Pending — Not Yet Registered' : result.approvalStatus === 'Approved' ? 'Successfully Enrolled' : result.approvalStatus;
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 4 OF 4</Text><Text style={styles.pageTitle}>{queued ? 'Pending Server Duplicate Check' : 'Identity Assigned'}</Text><Text style={styles.pageDescription}>{queued ? 'The service was unavailable while saving. Nothing is registered yet: the record waits on this device and the server runs the full duplicate check at the next sync. A possible duplicate is held for your review and never issued an ID automatically.' : result.duplicate ? 'Submitted for duplicate review. The record is Pending Review and must be approved by an authorised reviewer before its ID is active.' : isFarmer ? 'Your record has been saved and sent for verification.' : result.approvalStatus === 'Approved' ? 'No registered match was found. The animal and its biometric templates are saved.' : `Saved with status “${result.approvalStatus}”.`}</Text></View>
      <View style={styles.successCard}>
        <View style={styles.successIcon}><Ionicons name={queued ? 'time-outline' : 'checkmark'} size={32} color={colors.surface} /></View>
        <Text style={styles.successKicker}>{queued ? 'PROVISIONAL REFERENCE — NOT YET A MOOZZLE ID' : 'MOOZZLE ID'}</Text>
        <Text selectable style={styles.successId}>{formatMoozzleId(result.moozzleId)}</Text>
        <Pill label={statusLabel} tone={queued || result.approvalStatus !== 'Approved' ? 'amber' : 'green'} />
        {result.score !== null ? <Text style={styles.successDisclaimer}>1:N best similarity {result.score.toFixed(3)} across {result.templatesSearched ?? 0} templates · {summary.captures} templates stored · {ENGINE_MODEL}</Text> : null}
        {result.duplicate ? <Text style={styles.successDisclaimer}>Possible duplicate of {result.match?.in_scope ? formatMoozzleId(result.match.moozzle_id) : 'an existing animal'} — submitted for manual review, never merged automatically.</Text> : null}
      </View>
      <Card style={styles.summaryCard}><CaptureImage uri={cropUri} label="MUZZLE" size={92} /><View style={styles.summaryGrid}><SummaryItem label="Species" value={summary.animalType} /><SummaryItem label="Breed" value={summary.breed} /><SummaryItem label="Sex" value={summary.sex} /><SummaryItem label="Age" value={formatAge(summary.ageYears, summary.ageMonths)} /><SummaryItem label="Age group" value={summary.ageGroup ?? '—'} /><SummaryItem label="Status I" value={summary.productionStatus ?? '—'} /><SummaryItem label="Status II" value={summary.pregnancyStatus ?? '—'} /><SummaryItem label="Dairy society" value={summary.dairySociety === 'yes' ? 'YES' : summary.dairySociety === 'no' ? 'NO' : '—'} /><SummaryItem label="Location" value={`${summary.village}, ${summary.stateName}`} /><SummaryItem label="Frames" value={`${summary.captures} accepted`} /><SummaryItem label="Registered" value={summary.registeredAt ? formatLocalDateTime(summary.registeredAt) : '—'} /><SummaryItem label="GPS" value={summary.gps ? `${formatCoordinate(summary.gps.latitude, 'N', 'S')}, ${formatCoordinate(summary.gps.longitude, 'E', 'W')}${summary.gps.accuracy !== null ? ` · ±${Math.round(summary.gps.accuracy)} m` : ''}` : '—'} /></View></Card>
      {!queued ? <PrimaryButton label="VIEW ANIMAL PROFILE" icon="document-text-outline" onPress={onProfile} /> : null}
      <View style={styles.buttonRow}><PrimaryButton label="IDENTIFY AGAIN" onPress={onIdentify} variant="outline" style={styles.halfButton} /><PrimaryButton label="REGISTER ANOTHER" onPress={onRegisterAnother} variant="soft" style={styles.halfButton} /></View>
    </View>
  );
}

interface AgeStepperProps {
  label: string;
  unit: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}

function AgeStepper({ label, unit, value, max, onChange }: AgeStepperProps) {
  const canDecrease = value > 0;
  const canIncrease = value < max;
  const decrease = useCallback(() => onChange(Math.max(0, value - 1)), [onChange, value]);
  const increase = useCallback(() => onChange(Math.min(max, value + 1)), [max, onChange, value]);
  return (
    <View style={styles.ageStepperRow}>
      <View style={styles.ageStepperLabelWrap}>
        <Text style={styles.ageStepperLabel}>{label}</Text>
        <Text style={styles.ageStepperHint}>0–{max}</Text>
      </View>
      <View style={styles.stepperControl}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label.toLowerCase()}`} accessibilityState={{ disabled: !canDecrease }} disabled={!canDecrease} onPress={decrease} style={[styles.stepperButton, !canDecrease && styles.stepperButtonDisabled]}>
          <Ionicons name="remove" size={20} color={canDecrease ? colors.primary : colors.muted} />
        </Pressable>
        <View style={styles.ageStepperValueBox} accessibilityLabel={`${value} ${unit}`}>
          <Text style={styles.ageStepperValue}>{value}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label.toLowerCase()}`} accessibilityState={{ disabled: !canIncrease }} disabled={!canIncrease} onPress={increase} style={[styles.stepperButton, !canIncrease && styles.stepperButtonDisabled]}>
          <Ionicons name="add" size={20} color={canIncrease ? colors.primary : colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pageBody: { flex: 1 },
  // Stacked header: the cancel link and the title sit on separate rows so they can never collide,
  // whatever the viewport width or the phone's font scale.
  topBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  cancelButton: { minHeight: 44, alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -4, paddingRight: 8 },
  cancelText: { flexShrink: 1, color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 14 },
  topTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, paddingRight: 8, flexShrink: 1 },
  content: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 30, gap: 18 },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 2 },
  stepItem: { flex: 1, alignItems: 'center', position: 'relative', gap: 5 },
  stepCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNumber: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12 },
  stepNumberActive: { color: colors.surface },
  stepLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 10 },
  stepLabelActive: { color: colors.primary, fontFamily: Fonts.bold },
  stepLine: { position: 'absolute', top: 15, left: '62%', right: '-38%', height: 1, backgroundColor: colors.border, zIndex: -1 },
  stepLineActive: { backgroundColor: colors.accent },
  stepContent: { gap: 16 },
  eyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.1, marginBottom: 5 },
  pageTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 27 },
  pageDescription: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 5 },
  formCard: { gap: 18 },
  fieldBlock: { gap: 8 },
  gateNote: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  formSectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  optionRow: { flexDirection: 'row', gap: 9 },
  horizontalOptions: { flexGrow: 0 },
  horizontalOptionContent: { gap: 8, paddingRight: 10 },
  ageBlock: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, gap: 10 },
  ageHeader: { gap: 3 },
  ageStepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  ageStepperLabelWrap: { flexShrink: 1, gap: 1 },
  ageStepperLabel: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  ageStepperHint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  ageStepperValueBox: { minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  ageStepperValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18, fontVariant: ['tabular-nums'] },
  stepperButtonDisabled: { opacity: 0.45 },
  ageValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 22 },
  stepperControl: { flexDirection: 'row', gap: 9 },
  stepperButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  fieldGrid: { gap: 12 },
  captureCounter: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  reelCard: { gap: 14 },
  reelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reelHint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  thumbnailRow: { flexDirection: 'row', gap: 8, minHeight: 75, alignItems: 'center' },
  thumbnailWrap: { width: 57, gap: 3 },
  qualityText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 9 },
  reelEmpty: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  halfButton: { flex: 1, paddingHorizontal: 8 },
  processingCard: { gap: 4, paddingVertical: 20 },
  successCard: { borderRadius: 20, backgroundColor: colors.primary, padding: 24, alignItems: 'center', gap: 9 },
  successIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  successKicker: { color: '#B8E9CC', fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 2, marginTop: 5 },
  successId: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 28, fontVariant: ['tabular-nums'], letterSpacing: 1.1 },
  successDisclaimer: { color: '#D7F0DF', fontFamily: Fonts.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 6 },
  summaryCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  farmChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  summaryItem: { width: '50%', gap: 3 },
  summaryLabel: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  summaryValue: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  inlineError: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, borderRadius: 10, backgroundColor: colors.dangerLight },
  inlineErrorText: { flex: 1, color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  modalPanel: { width: '100%', maxWidth: 400, borderRadius: 18, backgroundColor: colors.surface, padding: 22, gap: 12 },
  modalIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 20 },
  modalText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 5 },
  modalAction: { flex: 1, paddingHorizontal: 8 },
  infoBox: { flexDirection: 'row', gap: 8, padding: 11, borderRadius: 10, backgroundColor: colors.blueLight, alignItems: 'center' },
  infoText: { flex: 1, color: '#075985', fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  retryButton: { minHeight: 44, paddingHorizontal: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.slateLight, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.blue },
  progressDone: { backgroundColor: colors.primary },
  consistency: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 9, textAlign: 'center' },
  consistencyLow: { color: colors.warning, fontFamily: Fonts.bold },
  removeFrame: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  warnText: { color: colors.warning, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  blockedCard: { borderRadius: 20, backgroundColor: colors.danger, padding: 22, alignItems: 'center', gap: 9 },
  blockedIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#B91C1C', alignItems: 'center', justifyContent: 'center' },
  blockedTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 19, letterSpacing: 0.6, textAlign: 'center' },
  blockedText: { color: '#FEE2E2', fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  compareRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
});
