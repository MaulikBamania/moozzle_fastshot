import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { CaptureImage, EnginePipeline, errorText, MuzzleCapture, ScoreMeter } from '@/components/biometric-ui';
import { analyzeMuzzle, uploadCapture } from '@/lib/biometric/engine';
import { cosineSimilarity, embeddingLiteral, ENGINE_MODEL } from '@/lib/biometric/features';
import { createAnimal, logAudit, useBovineStore, useSession, type RegisterResult } from '@/store/useBovineStore';
import { useCaptureHandoff } from '@/store/useCaptureHandoff';
import { useIsOnline } from '@/store/useConnectivity';
import type { AnimalType, MuzzleAnalysis, PipelineStage, Sex } from '@/store/types';
import { Fonts } from '@/constants/Typography';

const MIN_FRAMES = 3;
const MAX_FRAMES = 5;
const SAVE_STEPS = ['Uploading accepted muzzle frames (private, encrypted storage)', '1:N duplicate search across every enrolled template', 'Issuing permanent 12-digit MOOZZLE ID & writing audit log'];

const cattleBreeds = ['Gir', 'Sahiwal', 'Red Sindhi', 'Tharparkar', 'Rathi', 'Kankrej', 'Hariana', 'Jersey Cross', 'HF Cross', 'Other'];
const buffaloBreeds = ['Murrah', 'Mehsana', 'Jaffarabadi', 'Surti', 'Nili-Ravi', 'Bhadawari', 'Other'];

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
  const [animalType, setAnimalType] = useState<AnimalType>(handed?.detection.species === 'buffalo' ? 'Buffalo' : 'Cattle');
  const [breed, setBreed] = useState(handed?.detection.species === 'buffalo' ? 'Murrah' : 'Gir');
  const [sex, setSex] = useState<Sex>('Female');
  const [age, setAge] = useState(4);
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
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [saveStep, setSaveStep] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [registered, setRegistered] = useState<RegisterResult | null>(null);
  const [showCancel, setShowCancel] = useState(false);

  const breeds = animalType === 'Cattle' ? cattleBreeds : buffaloBreeds;

  useEffect(() => {
    clearHandoff(null);
  }, [clearHandoff]);

  const handleTypeChange = useCallback((value: AnimalType) => {
    setAnimalType(value);
    setBreed(value === 'Cattle' ? 'Gir' : 'Murrah');
  }, []);

  const handleFrame = useCallback(async (uri: string) => {
    if (frames.length >= MAX_FRAMES) return;
    setCaptureError('');
    setPendingUri(uri);
    setAnalyzing(true);
    try {
      const analysis = await analyzeMuzzle(uri, setStage);
      setPendingUri(null);
      if (!analysis.embedding) {
        setFeedback(analysis);
        void logAudit('biometric.capture', '', `Enrolment frame rejected: ${analysis.status}`, 'failed');
        return;
      }
      const embedding = analysis.embedding;
      const sims = frames.map((frame) => cosineSimilarity(frame.analysis.embedding ?? [], embedding));
      if (sims.some((value) => value > 0.9995)) {
        setFeedback({ ...analysis, status: 'PATTERN NOT CLEAR — RETAKE', hint: 'This frame is identical to one already accepted. Capture a new frame with a slightly different angle.', embedding: null });
        return;
      }
      const consistency = sims.length ? sims.reduce((sum, value) => sum + value, 0) / sims.length : null;
      setFeedback(analysis);
      setFrames((current) => [...current, { analysis, consistency, path: null }].slice(0, MAX_FRAMES));
    } catch (caught) {
      console.error('Enrolment frame analysis failed', caught);
      setCaptureError(errorText(caught, 'AI muzzle analysis failed. Check your connection and retry.'));
    } finally {
      setAnalyzing(false);
      setStage(null);
    }
  }, [frames]);

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
    if (!owner.trim() || !village.trim() || !district.trim() || !stateName.trim()) {
      setDetailsError('Owner name, village, district and state are required.');
      return;
    }
    if (!isFarmer && farmOptions.length > 0 && !selectedFarmId) {
      setDetailsError('Choose the assigned farm this animal belongs to.');
      return;
    }
    setDetailsError('');
    setStep(2);
  }, [district, farmOptions.length, isFarmer, owner, selectedFarmId, stateName, village]);
  const goToProcessing = useCallback(() => {
    if (frames.length >= MIN_FRAMES) {
      setSaveStep(-1);
      setSaveError('');
      setStep(3);
    }
  }, [frames.length]);

  const handleComplete = useCallback(async () => {
    if (saving || frames.length < MIN_FRAMES) return;
    setSaving(true);
    setSaveError('');
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
        animalType,
        breed,
        sex,
        ageYears: age,
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
      });
      setSaveStep(3);
      setRegistered(result);
      if (!result.blocked) setStep(4);
    } catch (caught) {
      console.error('Could not complete animal registration', caught);
      setSaveError(errorText(caught, 'The new animal could not be saved. Please retry.'));
      setSaveStep(-1);
    } finally {
      setSaving(false);
    }
  }, [age, animalType, breed, district, farmId, frames, owner, ownerPhone, saveAsDraft, saving, selectedFarmId, sex, stateName, village]);

  const resetWizard = useCallback(() => {
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
          {step === 1 && <DetailsStep animalType={animalType} breed={breed} sex={sex} age={age} stateName={stateName} district={district} village={village} owner={owner} ownerPhone={ownerPhone} farmId={farmId} breeds={breeds} farmOptions={farmOptions.map((farm) => ({ id: farm.id, label: `${farm.name} · ${farm.village}` }))} selectedFarmId={selectedFarmId} onFarm={chooseFarm} isFarmer={isFarmer} error={detailsError} onType={handleTypeChange} onBreed={setBreed} onSex={setSex} onAge={setAge} onState={setStateName} onDistrict={setDistrict} onVillage={setVillage} onOwner={setOwner} onOwnerPhone={setOwnerPhone} onFarmId={setFarmId} onNext={goToCapture} />}
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
              onRetry={() => { if (pendingUri) void handleFrame(pendingUri); }}
              onFrame={(uri) => void handleFrame(uri)}
              onRemove={removeFrame}
              onBack={() => setStep(1)}
              onNext={goToProcessing}
            />
          )}
          {step === 3 && <ProcessingStep frames={frames.length} activeStep={saveStep} saving={saving} saveError={saveError} needsApproval={needsApproval} saveAsDraft={saveAsDraft} blocked={registered?.blocked ? registered : null} onDraft={setSaveAsDraft} onBack={() => { setRegistered(null); setStep(2); }} onComplete={() => void handleComplete()} onExit={() => router.replace('/(tabs)')} />}
          {step === 4 && registered && <SuccessStep result={registered} summary={{ animalType, breed, sex, age, village, stateName, captures: frames.length }} cropUri={frames[0]?.analysis.cropUri ?? null} isFarmer={isFarmer} onProfile={() => router.push(`/animal/${registered.moozzleId}`)} onIdentify={() => router.replace('/(tabs)/identify')} onRegisterAnother={resetWizard} />}
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
              <PrimaryButton label="Cancel Enrolment" onPress={() => { setShowCancel(false); router.back(); }} variant="danger" style={styles.modalAction} />
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
  onAge: (value: number) => void;
  onState: (value: string) => void;
  onDistrict: (value: string) => void;
  onVillage: (value: string) => void;
  onOwner: (value: string) => void;
  onOwnerPhone: (value: string) => void;
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
        {props.farmOptions.length > 0 ? (
          <>
            <Text style={styles.pageDescription}>Assigned farm (only farms in your authorised scope)</Text>
            <View style={styles.farmChips}>{props.farmOptions.map((farm) => <OptionChip key={farm.id} label={farm.label} selected={props.selectedFarmId === farm.id} onPress={() => props.onFarm(farm.id)} />)}</View>
          </>
        ) : null}
        {props.isFarmer ? <Text style={styles.pageDescription}>This animal will be linked to your account and sent for verification.</Text> : null}
        <View style={styles.fieldGrid}><TextField label="State" value={props.stateName} onChangeText={props.onState} /><TextField label="District" value={props.district} onChangeText={props.onDistrict} /><TextField label="Village" value={props.village} onChangeText={props.onVillage} /><TextField label="Owner name" value={props.owner} onChangeText={props.onOwner} placeholder="Farmer's full name" /><TextField label="Owner phone (optional)" value={props.ownerPhone} onChangeText={props.onOwnerPhone} keyboardType="phone-pad" placeholder="+91 98765 43210" />{props.farmOptions.length === 0 ? <TextField label="Farm name / ID (optional)" value={props.farmId} onChangeText={props.onFarmId} placeholder="FARM-GJ-044" /> : null}</View>
      </Card>
      {props.error ? <View style={styles.inlineError}><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text selectable style={styles.inlineErrorText}>{props.error}</Text></View> : null}
      <PrimaryButton label="Next: Capture Muzzle Pattern" icon="arrow-forward" onPress={props.onNext} />
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
  onRetry: () => void;
  onFrame: (uri: string) => void;
  onRemove: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
}

function CaptureStep(props: CaptureStepProps) {
  const { frames } = props;
  const full = frames.length >= MAX_FRAMES;
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 2 OF 4</Text><Text style={styles.pageTitle}>Capture Muzzle</Text><Text style={styles.pageDescription}>Capture {MIN_FRAMES}–{MAX_FRAMES} accepted frames. Each one passes AI muzzle detection and measured quality checks before its embedding is kept.</Text></View>
      {props.prefilled ? <View style={styles.infoBox}><Ionicons name="link-outline" size={17} color={colors.blue} /><Text style={styles.infoText}>Frame 1 was carried over from your Identify scan (no registered match).</Text></View> : null}
      {!props.online ? <View style={styles.inlineError}><Ionicons name="cloud-offline-outline" size={17} color={colors.danger} /><Text style={styles.inlineErrorText}>Muzzle analysis needs a connection to the AI Gateway. Reconnect to capture frames.</Text></View> : null}
      <MuzzleCapture onFrame={props.onFrame} busy={props.analyzing} feedback={props.feedback} captureLabel={full ? 'Frames Complete' : `Capture Frame ${frames.length + 1}`} disabled={full || !props.online} />
      {props.analyzing ? <Card style={styles.processingCard}><EnginePipeline stage={props.stage} includeSearch={false} /></Card> : null}
      {props.error ? <View style={styles.inlineError}><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text selectable style={styles.inlineErrorText}>{props.error}</Text>{props.canRetry ? <PrimaryButton label="Retry" variant="outline" onPress={props.onRetry} style={styles.retryButton} /> : null}</View> : null}
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
  activeStep: number;
  saving: boolean;
  saveError: string;
  needsApproval: boolean;
  saveAsDraft: boolean;
  blocked: RegisterResult | null;
  onDraft: (value: boolean) => void;
  onBack: () => void;
  onComplete: () => void;
  onExit: () => void;
}

function ProcessingStep(props: ProcessingProps) {
  const settings = useBovineStore((state) => state.settings);
  const matchT = Number(settings.find((item) => item.key === 'match_threshold')?.value ?? 0.85);
  const reviewT = Number(settings.find((item) => item.key === 'review_threshold')?.value ?? 0.7);
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
      <View><Text style={styles.eyebrow}>STEP 3 OF 4</Text><Text style={styles.pageTitle}>Duplicate Check</Text><Text style={styles.pageDescription}>{props.frames} embeddings are searched against every enrolled template on the server before any ID is issued. A confirmed match blocks registration; an uncertain one goes to manual review.</Text></View>
      <Card style={styles.processingCard}><PipelineList steps={SAVE_STEPS} activeStep={props.activeStep} /></Card>
      <Card style={styles.formCard}>
        <Text style={styles.formSectionTitle}>Save as</Text>
        <View style={styles.optionRow}>
          <OptionChip label={props.needsApproval ? 'Submit for approval' : 'Enrol now'} selected={!props.saveAsDraft} onPress={() => props.onDraft(false)} />
          <OptionChip label="Save draft" selected={props.saveAsDraft} onPress={() => props.onDraft(true)} tone="blue" />
        </View>
        <Text style={styles.pageDescription}>{props.saveAsDraft ? 'Drafts stay private to you until submitted. The duplicate check still runs.' : props.needsApproval ? 'Your role’s registrations are reviewed by an authorised approver.' : 'Your role can enrol directly within your authorised scope.'}</Text>
      </Card>
      <View style={styles.buttonRow}><PrimaryButton label="Back" onPress={props.onBack} variant="outline" style={styles.halfButton} disabled={props.saving} /><PrimaryButton label={props.saving ? 'Checking…' : props.saveError ? 'Retry' : 'Check & Register'} icon="shield-checkmark-outline" onPress={props.onComplete} disabled={props.saving} style={styles.halfButton} /></View>
      {props.saveError ? <View style={styles.inlineError}><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text selectable style={styles.inlineErrorText}>{props.saveError}</Text></View> : null}
    </View>
  );
}

interface SuccessSummary { animalType: AnimalType; breed: string; sex: Sex; age: number; village: string; stateName: string; captures: number }

function SuccessStep({ result, summary, cropUri, isFarmer, onProfile, onIdentify, onRegisterAnother }: { result: RegisterResult; summary: SuccessSummary; cropUri: string | null; isFarmer: boolean; onProfile: () => void; onIdentify: () => void; onRegisterAnother: () => void }) {
  const queued = result.queued;
  const statusLabel = queued ? 'Queued for Sync' : result.approvalStatus === 'Approved' ? 'Successfully Enrolled' : result.approvalStatus;
  return (
    <View style={styles.stepContent}>
      <View><Text style={styles.eyebrow}>STEP 4 OF 4</Text><Text style={styles.pageTitle}>Identity Assigned</Text><Text style={styles.pageDescription}>{queued ? 'The connection dropped while saving. The record is on this device and the server re-runs the duplicate check at the next sync; the ID shown is provisional until then.' : isFarmer ? 'Your record has been saved and sent for verification.' : result.approvalStatus === 'Approved' ? 'No registered match was found. The animal and its biometric templates are saved.' : `Saved with status “${result.approvalStatus}”.`}</Text></View>
      <View style={styles.successCard}>
        <View style={styles.successIcon}><Ionicons name="checkmark" size={32} color={colors.surface} /></View>
        <Text style={styles.successKicker}>MOOZZLE ID</Text>
        <Text selectable style={styles.successId}>{formatMoozzleId(result.moozzleId)}</Text>
        <Pill label={statusLabel} tone={queued || result.approvalStatus !== 'Approved' ? 'amber' : 'green'} />
        {result.score !== null ? <Text style={styles.successDisclaimer}>1:N best similarity {result.score.toFixed(3)} across {result.templatesSearched ?? 0} templates · {summary.captures} templates stored · {ENGINE_MODEL}</Text> : null}
        {result.duplicate ? <Text style={styles.successDisclaimer}>Uncertain similarity to {result.match?.in_scope ? formatMoozzleId(result.match.moozzle_id) : 'an existing animal'} — sent for manual review instead of being merged.</Text> : null}
      </View>
      <Card style={styles.summaryCard}><CaptureImage uri={cropUri} label="MUZZLE" size={92} /><View style={styles.summaryGrid}><SummaryItem label="Species" value={summary.animalType} /><SummaryItem label="Breed" value={summary.breed} /><SummaryItem label="Sex" value={summary.sex} /><SummaryItem label="Age" value={`${summary.age} yrs`} /><SummaryItem label="Location" value={`${summary.village}, ${summary.stateName}`} /><SummaryItem label="Frames" value={`${summary.captures} accepted`} /></View></Card>
      {!queued ? <PrimaryButton label="VIEW ANIMAL PROFILE" icon="document-text-outline" onPress={onProfile} /> : null}
      <View style={styles.buttonRow}><PrimaryButton label="IDENTIFY AGAIN" onPress={onIdentify} variant="outline" style={styles.halfButton} /><PrimaryButton label="REGISTER ANOTHER" onPress={onRegisterAnother} variant="soft" style={styles.halfButton} /></View>
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pageBody: { flex: 1 },
  // Stacked header: the cancel link and the title sit on separate rows so they can never collide,
  // whatever the viewport width or the phone's font scale.
  topBar: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  cancelButton: { minHeight: 44, alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -4, paddingRight: 8 },
  cancelText: { flexShrink: 1, color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 14 },
  topTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28 },
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
