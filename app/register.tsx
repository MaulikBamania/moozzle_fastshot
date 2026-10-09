import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AppScreen,
  AnimalPhoto,
  Card,
  colors,
  ErrorState,
  OptionChip,
  PipelineList,
  Pill,
  PrimaryButton,
  TextField,
  Viewfinder,
  getAnimalImageSource,
  StorageGate,
} from '@/components/moozzle-ui';
import { useAppStore } from '@/store/useAppStore';
import type { Animal, AnimalType, BiometricTemplate, Sex } from '@/store/types';
import { Fonts } from '@/constants/Typography';

const PIPELINE_STEPS = [
  'Detecting muzzle contours',
  'Assessing ridge & valley clarity',
  'Normalizing angle & lighting',
  'Extracting ridge bifurcation & bead embeddings',
  'Creating biometric template (256-dim)',
  'Searching existing database (1:N Duplicate Check)',
];

const cattleBreeds = ['Gir', 'Sahiwal', 'Red Sindhi', 'Tharparkar', 'Rathi', 'Kankrej', 'Hariana', 'Jersey Cross', 'HF Cross', 'Other'];
const buffaloBreeds = ['Murrah', 'Mehsana', 'Jaffarabadi', 'Surti', 'Nili-Ravi', 'Bhadawari', 'Other'];

export default function RegisterScreen() {
  return <StorageGate><RegisterContent /></StorageGate>;
}

function RegisterContent() {
  const animals = useAppStore((state) => state.animals);
  const addAnimal = useAppStore((state) => state.addAnimal);
  const [step, setStep] = useState(1);
  const [animalType, setAnimalType] = useState<AnimalType>('Cattle');
  const [breed, setBreed] = useState('Gir');
  const [sex, setSex] = useState<Sex>('Female');
  const [age, setAge] = useState(4);
  const [stateName, setStateName] = useState('Gujarat');
  const [district, setDistrict] = useState('Ahmedabad');
  const [village, setVillage] = useState('Sanand');
  const [owner, setOwner] = useState('Demo Farmer Patel');
  const [farmId, setFarmId] = useState('FARM-GJ-044');
  const [captures, setCaptures] = useState<number[]>([]);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [processingComplete, setProcessingComplete] = useState(false);
  const [registeredAnimal, setRegisteredAnimal] = useState<Animal | null>(null);
  const [error, setError] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  const breeds = animalType === 'Cattle' ? cattleBreeds : buffaloBreeds;
  const imageUri = animalType === 'Cattle' ? 'asset://gir' : 'asset://murrah';
  const captureQuality = useMemo(() => [96, 92, 95, 94, 97], []);

  useEffect(() => {
    if (step !== 3) return undefined;
    const timer = setInterval(() => {
      setPipelineStep((current) => {
        if (current >= PIPELINE_STEPS.length) {
          clearInterval(timer);
          setProcessingComplete(true);
          return current;
        }
        return current + 1;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [step]);

  const handleTypeChange = useCallback((value: AnimalType) => {
    setAnimalType(value);
    setBreed(value === 'Cattle' ? 'Gir' : 'Murrah');
  }, []);
  const handleCapture = useCallback(() => {
    setCaptures((current) => current.length >= 5 ? current : [...current, current.length + 1]);
  }, []);
  const goToCapture = useCallback(() => setStep(2), []);
  const goToProcessing = useCallback(() => {
    if (captures.length === 5) {
      setPipelineStep(0);
      setProcessingComplete(false);
      setStep(3);
    }
  }, [captures.length]);
  const generateId = useCallback(() => {
    const existing = new Set(animals.map((item) => item.moozzle_id));
    let candidate = String(Date.now()).slice(-12).padStart(12, '4');
    while (existing.has(candidate)) candidate = String(Number(candidate) + 1).padStart(12, '0').slice(-12);
    return candidate;
  }, [animals]);
  const handleComplete = useCallback(() => {
    try {
      if (!processingComplete) return;
      const createdAt = new Date().toISOString();
      const id = generateId();
      const templateId = `demo-template-${id.slice(-6)}`;
      const created: Animal = {
        moozzle_id: id,
        animal_type: animalType,
        breed,
        sex,
        age_years: age,
        owner_name: owner,
        owner_phone: '+91 98765 43210',
        farm_name: farmId,
        village,
        district,
        state: stateName,
        registration_date: createdAt,
        biometric_status: 'Enrolled',
        current_status: 'Active',
        reference_muzzle_uri: imageUri,
        captured_images_count: captures.length,
        biometric_template_id: templateId,
        created_at: createdAt,
        updated_at: createdAt,
      };
      const template: BiometricTemplate = {
        template_id: templateId,
        moozzle_id: id,
        quality_score: 0.95,
        model_version: 'demo-v1.0',
        created_at: createdAt,
      };
      addAnimal(created, template);
      setRegisteredAnimal(created);
      setStep(4);
    } catch (caught) {
      console.error('Could not complete animal registration', caught);
      setError('The new animal could not be saved. Please retry registration.');
    }
  }, [addAnimal, age, animalType, breed, captures.length, district, farmId, generateId, imageUri, owner, processingComplete, sex, stateName, village]);
  const resetWizard = useCallback(() => {
    setStep(1);
    setCaptures([]);
    setPipelineStep(0);
    setProcessingComplete(false);
    setRegisteredAnimal(null);
    setError('');
  }, []);
  const handleCancel = useCallback(() => setShowCancel(false), []);

  if (error) return <ErrorState message={error} onRetry={() => setError('')} />;

  return (
    <AppScreen>
      <View style={styles.pageBody}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" onPress={() => setShowCancel(true)} style={styles.cancelButton}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={styles.cancelText}>Cancel Enrolment</Text>
          </Pressable>
          <Text style={styles.topTitle}>Register Animal</Text>
          <View style={styles.topSpacer} />
        </View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
          <WizardStepper step={step} />
          {step === 1 && <DetailsStep animalType={animalType} breed={breed} sex={sex} age={age} stateName={stateName} district={district} village={village} owner={owner} farmId={farmId} breeds={breeds} onType={handleTypeChange} onBreed={setBreed} onSex={setSex} onAge={setAge} onState={setStateName} onDistrict={setDistrict} onVillage={setVillage} onOwner={setOwner} onFarmId={setFarmId} onNext={goToCapture} />}
          {step === 2 && <CaptureStep captures={captures} captureQuality={captureQuality} imageUri={imageUri} onCapture={handleCapture} onBack={() => setStep(1)} onNext={goToProcessing} />}
          {step === 3 && <ProcessingStep activeStep={pipelineStep} complete={processingComplete} onBack={() => setStep(2)} onComplete={handleComplete} />}
          {step === 4 && registeredAnimal && <SuccessStep animal={registeredAnimal} onProfile={() => router.push(`/animal/${registeredAnimal.moozzle_id}`)} onIdentify={() => router.replace('/(tabs)/identify' as never)} onRegisterAnother={resetWizard} />}
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
              <PrimaryButton label="Cancel Enrolment" onPress={() => router.back()} variant="danger" style={styles.modalAction} />
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

interface DetailsProps {
  animalType: AnimalType;
  breed: string;
  sex: Sex;
  age: number;
  stateName: string;
  district: string;
  village: string;
  owner: string;
  farmId: string;
  breeds: string[];
  onType: (value: AnimalType) => void;
  onBreed: (value: string) => void;
  onSex: (value: Sex) => void;
  onAge: (value: number) => void;
  onState: (value: string) => void;
  onDistrict: (value: string) => void;
  onVillage: (value: string) => void;
  onOwner: (value: string) => void;
  onFarmId: (value: string) => void;
  onNext: () => void;
}

function DetailsStep(props: DetailsProps) {
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 1 OF 4</Text><Text style={styles.pageTitle}>Animal Demographics</Text><Text style={styles.pageDescription}>Set the identity details before capturing the muzzle pattern.</Text></View>
      <Card style={styles.formCard}>
        <Text style={styles.formSectionTitle}>Bovine species</Text>
        <View style={styles.optionRow}><OptionChip label="CATTLE" selected={props.animalType === 'Cattle'} onPress={() => props.onType('Cattle')} /><OptionChip label="BUFFALO" selected={props.animalType === 'Buffalo'} onPress={() => props.onType('Buffalo')} tone="blue" /></View>
        <Text style={styles.formSectionTitle}>Breed</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalOptions} contentContainerStyle={styles.horizontalOptionContent}>
          {props.breeds.map((item) => <OptionChip key={item} label={item} selected={props.breed === item} onPress={() => props.onBreed(item)} />)}
        </ScrollView>
        <Text style={styles.formSectionTitle}>Sex</Text>
        <View style={styles.optionRow}><OptionChip label="Female" selected={props.sex === 'Female'} onPress={() => props.onSex('Female')} /><OptionChip label="Male" selected={props.sex === 'Male'} onPress={() => props.onSex('Male')} /></View>
        <View style={styles.ageRow}><View><Text style={styles.formSectionTitle}>Approximate age</Text><Text style={styles.ageValue}>{props.age} years</Text></View><View style={styles.stepperControl}><Pressable accessibilityRole="button" onPress={() => props.onAge(Math.max(0, props.age - 1))} style={styles.stepperButton}><Ionicons name="remove" size={20} color={colors.primary} /></Pressable><Pressable accessibilityRole="button" onPress={() => props.onAge(Math.min(20, props.age + 1))} style={styles.stepperButton}><Ionicons name="add" size={20} color={colors.primary} /></Pressable></View></View>
      </Card>
      <Card style={styles.formCard}>
        <Text style={styles.formSectionTitle}>Location & ownership</Text>
        <View style={styles.fieldGrid}><TextField label="State" value={props.stateName} onChangeText={props.onState} /><TextField label="District" value={props.district} onChangeText={props.onDistrict} /><TextField label="Village" value={props.village} onChangeText={props.onVillage} /><TextField label="Owner name" value={props.owner} onChangeText={props.onOwner} /><TextField label="Farm ID" value={props.farmId} onChangeText={props.onFarmId} /></View>
      </Card>
      <PrimaryButton label="Next: Capture Muzzle Pattern" icon="arrow-forward" onPress={props.onNext} />
    </View>
  );
}

function CaptureStep({ captures, captureQuality, imageUri, onCapture, onBack, onNext }: { captures: number[]; captureQuality: number[]; imageUri: string; onCapture: () => void; onBack: () => void; onNext: () => void }) {
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 2 OF 4</Text><Text style={styles.pageTitle}>Capture Muzzle</Text><Text style={styles.pageDescription}>Take 5 clear frames. Small angle changes help create a reliable demo template.</Text></View>
      <Viewfinder label="Position muzzle inside the oval. Keep distance 15-25 cm." />
      <View style={styles.captureStatus}><Pill label="Good ✓" /><Text style={styles.captureCounter}>Frame: {captures.length} / 5</Text></View>
      <PrimaryButton label={captures.length === 5 ? '5/5 Frames Captured' : 'Capture Muzzle Photo'} icon="camera" onPress={onCapture} disabled={captures.length === 5} />
      <Card style={styles.reelCard}>
        <View style={styles.reelHeader}><Text style={styles.formSectionTitle}>Captured muzzle frames</Text><Text style={styles.reelHint}>High-resolution crops</Text></View>
        <View style={styles.thumbnailRow}>
          {captures.map((capture, index) => <View style={styles.thumbnailWrap} key={capture}><Image source={getAnimalImageSource(imageUri)} contentFit="cover" style={styles.thumbnail} /><View style={styles.qualityBadge}><Ionicons name="checkmark-circle" size={13} color={colors.accent} /><Text style={styles.qualityText}>{captureQuality[index]}%</Text></View></View>)}
          {captures.length === 0 && <Text style={styles.reelEmpty}>Your accepted frames will appear here.</Text>}
        </View>
      </Card>
      <View style={styles.buttonRow}><PrimaryButton label="Back" onPress={onBack} variant="outline" style={styles.halfButton} /><PrimaryButton label={`Proceed to Processing (${captures.length}/5)`} icon="arrow-forward" onPress={onNext} disabled={captures.length !== 5} style={styles.halfButton} /></View>
    </View>
  );
}

function ProcessingStep({ activeStep, complete, onBack, onComplete }: { activeStep: number; complete: boolean; onBack: () => void; onComplete: () => void }) {
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 3 OF 4</Text><Text style={styles.pageTitle}>Biometric Processing</Text><Text style={styles.pageDescription}>The demo pipeline is checking quality and searching for a duplicate identity.</Text></View>
      <Card style={styles.processingCard}><PipelineList steps={PIPELINE_STEPS} activeStep={activeStep} /></Card>
      {complete ? <View style={styles.outcomeCard}><Ionicons name="checkmark-circle" size={25} color={colors.accent} /><View style={styles.outcomeCopy}><Text style={styles.outcomeTitle}>No matching animal found</Text><Text style={styles.outcomeText}>Proceeding to assign a unique identity.</Text></View></View> : <View style={styles.processingNote}><ActivityPulse /><Text style={styles.processingNoteText}>Extracting muzzle ridge embeddings locally…</Text></View>}
      <View style={styles.buttonRow}><PrimaryButton label="Back" onPress={onBack} variant="outline" style={styles.halfButton} /><PrimaryButton label="Complete Registration" icon="checkmark" onPress={onComplete} disabled={!complete} style={styles.halfButton} /></View>
    </View>
  );
}

function ActivityPulse() { return <View style={styles.activityPulse}><View style={styles.pulseDot} /><View style={styles.pulseDot} /><View style={styles.pulseDot} /></View>; }

function SuccessStep({ animal, onProfile, onIdentify, onRegisterAnother }: { animal: Animal; onProfile: () => void; onIdentify: () => void; onRegisterAnother: () => void }) {
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 4 OF 4</Text><Text style={styles.pageTitle}>Identity Assigned</Text><Text style={styles.pageDescription}>The animal is now enrolled in this device&apos;s local MOOZZLE archive.</Text></View>
      <View style={styles.successCard}><View style={styles.successIcon}><Ionicons name="checkmark" size={32} color={colors.surface} /></View><Text style={styles.successKicker}>MOOZZLE ID</Text><Text selectable style={styles.successId}>{animal.moozzle_id.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}</Text><Pill label="Successfully Enrolled" /><Text style={styles.successDisclaimer}>Prototype biometric confidence is unvalidated and for demo workflow only.</Text></View>
      <Card style={styles.summaryCard}><View style={styles.summaryImage}><AnimalPhoto animal={animal} size={92} /></View><View style={styles.summaryGrid}><SummaryItem label="Species" value={animal.animal_type} /><SummaryItem label="Breed" value={animal.breed} /><SummaryItem label="Sex" value={animal.sex} /><SummaryItem label="Age" value={`${animal.age_years} yrs`} /><SummaryItem label="Location" value={`${animal.village}, ${animal.state}`} /><SummaryItem label="Frames" value={`${animal.captured_images_count} good`} /></View></Card>
      <PrimaryButton label="VIEW ANIMAL PROFILE" icon="document-text-outline" onPress={onProfile} />
      <View style={styles.buttonRow}><PrimaryButton label="IDENTIFY AGAIN" onPress={onIdentify} variant="outline" style={styles.halfButton} /><PrimaryButton label="REGISTER ANOTHER" onPress={onRegisterAnother} variant="soft" style={styles.halfButton} /></View>
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pageBody: { flex: 1 },
  topBar: { minHeight: 55, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  cancelButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  cancelText: { color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  topTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  topSpacer: { width: 108 },
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
  formCard: { gap: 14 },
  formSectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  optionRow: { flexDirection: 'row', gap: 9 },
  horizontalOptions: { flexGrow: 0 },
  horizontalOptionContent: { gap: 8, paddingRight: 10 },
  ageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  ageValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 22, marginTop: 3 },
  stepperControl: { flexDirection: 'row', gap: 9 },
  stepperButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  fieldGrid: { gap: 12 },
  captureStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  captureCounter: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  reelCard: { gap: 14 },
  reelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reelHint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  thumbnailRow: { flexDirection: 'row', gap: 8, minHeight: 75, alignItems: 'center' },
  thumbnailWrap: { width: 57, gap: 3 },
  thumbnail: { width: 57, height: 53, borderRadius: 8 },
  qualityBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  qualityText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 9 },
  reelEmpty: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  halfButton: { flex: 1, paddingHorizontal: 8 },
  processingCard: { gap: 4, paddingVertical: 20 },
  outcomeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, backgroundColor: colors.primaryLight },
  outcomeCopy: { flex: 1, gap: 3 },
  outcomeTitle: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 14 },
  outcomeText: { color: '#477052', fontFamily: Fonts.regular, fontSize: 13 },
  processingNote: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', padding: 11 },
  processingNoteText: { color: colors.blue, fontFamily: Fonts.medium, fontSize: 13 },
  activityPulse: { flexDirection: 'row', gap: 4 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.blue },
  successCard: { borderRadius: 20, backgroundColor: colors.primary, padding: 24, alignItems: 'center', gap: 9 },
  successIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#4CAF67', alignItems: 'center', justifyContent: 'center' },
  successKicker: { color: '#B8E9CC', fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 2, marginTop: 5 },
  successId: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 28, fontVariant: ['tabular-nums'], letterSpacing: 1.1 },
  successDisclaimer: { color: '#D7F0DF', fontFamily: Fonts.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 6 },
  summaryCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  summaryImage: { paddingTop: 1 },
  summaryGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  summaryItem: { width: '50%', gap: 3 },
  summaryLabel: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  summaryValue: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  modalPanel: { width: '100%', maxWidth: 400, borderRadius: 18, backgroundColor: colors.surface, padding: 22, gap: 12 },
  modalIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 20 },
  modalText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 5 },
  modalAction: { flex: 1, paddingHorizontal: 8 },
});
