import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import {
  AnimalPhoto,
  AppScreen,
  Card,
  colors,
  ErrorState,
  formatMoozzleId,
  OptionChip,
  Pill,
  PrimaryButton,
  StorageGate,
  TextField,
} from '@/components/moozzle-ui';
import { useAppStore } from '@/store/useAppStore';
import type { Animal, LivestockRecordType } from '@/store/types';
import { Fonts } from '@/constants/Typography';

type ProfileTab = 'Overview' | 'AI & Breeding' | 'Health' | 'Insurance' | 'Traceability';
type ServiceForm = 'ai' | 'health' | null;

export default function AnimalProfileScreen() {
  return <StorageGate><AnimalProfileContent /></StorageGate>;
}

function AnimalProfileContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const animals = useAppStore((state) => state.animals);
  const serviceRecords = useAppStore((state) => state.serviceRecords);
  const addServiceRecord = useAppStore((state) => state.addServiceRecord);
  const retireAnimal = useAppStore((state) => state.retireAnimal);
  const animal = useMemo(() => animals.find((item) => item.moozzle_id === id), [animals, id]);
  const records = useMemo(() => serviceRecords.filter((item) => item.moozzle_id === id), [id, serviceRecords]);
  const [activeTab, setActiveTab] = useState<ProfileTab>('Overview');
  const [serviceForm, setServiceForm] = useState<ServiceForm>(null);
  const [bullBreed, setBullBreed] = useState('Gir Champion 04');
  const [strawCode, setStrawCode] = useState('GIR-BULL-04');
  const [healthItem, setHealthItem] = useState('FMD-Raksha');
  const [serviceDetails, setServiceDetails] = useState('');
  const [serviceBy, setServiceBy] = useState('AI Tech Ramesh');
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState('Permanent Sale / Transfer');
  const [retireNotes, setRetireNotes] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const aiRecords = useMemo(() => records.filter((item) => item.record_type === 'Artificial Insemination' || item.record_type === 'Pregnancy Diagnosis' || item.record_type === 'Calving'), [records]);
  const healthRecords = useMemo(() => records.filter((item) => item.record_type === 'Vaccination' || item.record_type === 'Treatment'), [records]);
  const insuranceRecord = useMemo(() => records.find((item) => item.record_type === 'Insurance Verification'), [records]);

  const handleCopy = useCallback(async () => {
    if (!animal) return;
    try {
      await Clipboard.setStringAsync(animal.moozzle_id);
      setNotice('MOOZZLE ID copied to clipboard.');
    } catch (caught) {
      console.error('Could not copy animal ID', caught);
      setError('Copy is unavailable on this device. The ID remains selectable.');
    }
  }, [animal]);
  const handleShare = useCallback(async () => {
    if (!animal) return;
    try {
      await Share.share({ message: `MOOZZLE ID ${formatMoozzleId(animal.moozzle_id)} · ${animal.breed} ${animal.animal_type} · ${animal.owner_name}` });
      setNotice('Animal summary is ready to share.');
    } catch (caught) {
      console.error('Could not share animal summary', caught);
      try {
        await Clipboard.setStringAsync(`${formatMoozzleId(animal.moozzle_id)} · ${animal.breed} ${animal.animal_type} · ${animal.owner_name}`);
        setNotice('Share is unavailable here. Summary copied instead.');
      } catch (fallbackError) {
        console.error('Could not copy animal summary', fallbackError);
        setError('The animal summary could not be shared.');
      }
    }
  }, [animal]);
  const handleOpenService = useCallback((form: Exclude<ServiceForm, null>) => {
    setServiceForm(form);
    setServiceDetails('');
    setHealthItem('FMD-Raksha');
    setNotice('');
  }, []);
  const handleSaveService = useCallback(async () => {
    if (!animal || !serviceForm) return;
    try {
      const isAi = serviceForm === 'ai';
      const type: LivestockRecordType = isAi ? 'Artificial Insemination' : 'Vaccination';
      addServiceRecord({
        id: `svc-${Date.now()}-${animal.moozzle_id.slice(-4)}`,
        moozzle_id: animal.moozzle_id,
        record_type: type,
        date: new Date().toISOString().slice(0, 10),
        performed_by: serviceBy || (isAi ? 'AI Tech Ramesh' : 'Dr. Mehta'),
        details: serviceDetails || (isAi ? 'AI service recorded from Livestock Service Hub.' : 'Vaccination recorded from Livestock Service Hub.'),
        metadata: isAi ? { bull_breed: bullBreed, straw_code: strawCode } : { vaccine_name: healthItem || 'FMD-Raksha' },
      });
      setServiceForm(null);
      setActiveTab(isAi ? 'AI & Breeding' : 'Health');
      setNotice(`${type} record saved to this animal's local history.`);
    } catch (caught) {
      console.error('Could not save livestock service record', caught);
      setError('The service record could not be saved. Please retry.');
    }
  }, [addServiceRecord, animal, bullBreed, healthItem, serviceBy, serviceDetails, serviceForm, strawCode]);
  const handleRetire = useCallback(() => {
    if (!animal) return;
    try {
      retireAnimal(animal.moozzle_id, retireReason, retireNotes);
      setRetireOpen(false);
      setNotice('Animal retired. Its permanent ID remains in the audit archive.');
    } catch (caught) {
      console.error('Could not retire animal', caught);
      setError('Retirement could not be saved. Please retry.');
    }
  }, [animal, retireAnimal, retireNotes, retireReason]);

  if (error) return <ErrorState message={error} onRetry={() => setError('')} />;
  if (!animal) return <ErrorState message="This MOOZZLE ID is not available on this device." onRetry={() => router.back()} />;

  return (
    <AppScreen>
      <View style={styles.pageBody}>
        <View style={styles.topBar}><Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Ionicons name="chevron-back" size={24} color={colors.text} /><Text style={styles.backText}>Animal Records</Text></Pressable><Text style={styles.topId}>{formatMoozzleId(animal.moozzle_id)}</Text><Pressable accessibilityRole="button" onPress={handleShare} style={styles.shareButton}><Ionicons name="share-outline" size={21} color={colors.primary} /></Pressable></View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
          {notice && <Pressable accessibilityRole="button" onPress={() => setNotice('')} style={styles.notice}><Ionicons name="checkmark-circle" size={18} color={colors.accent} /><Text style={styles.noticeText}>{notice}</Text><Ionicons name="close" size={16} color={colors.muted} /></Pressable>}
          <ProfileHero animal={animal} onCopy={handleCopy} />
          <View style={styles.tabScroller}><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.profileTabs}>{(['Overview', 'AI & Breeding', 'Health', 'Insurance', 'Traceability'] as ProfileTab[]).map((tab) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab }} key={tab} onPress={() => setActiveTab(tab)} style={[styles.profileTab, activeTab === tab && styles.profileTabActive]}><Text style={[styles.profileTabText, activeTab === tab && styles.profileTabTextActive]}>{tab}</Text></Pressable>)}</ScrollView></View>
          {activeTab === 'Overview' && <OverviewPanel animal={animal} />}
          {activeTab === 'AI & Breeding' && <ServicePanel title="AI & Breeding" icon="flask-outline" records={aiRecords} empty="No AI or breeding entries yet." action="Add AI Record" onAction={() => handleOpenService('ai')} />}
          {activeTab === 'Health' && <ServicePanel title="Health & Vaccination" icon="medkit-outline" records={healthRecords} empty="No vaccination or treatment entries yet." action="Add Health Record" onAction={() => handleOpenService('health')} />}
          {activeTab === 'Insurance' && <InsurancePanel animal={animal} record={insuranceRecord} />}
          {activeTab === 'Traceability' && <TraceabilityPanel animal={animal} records={records} />}
          <View style={styles.retireSection}><Text style={styles.retireTitle}>Lifecycle management</Text><Text style={styles.retireText}>Retired IDs are preserved permanently in the audit archive and are never reused.</Text>{animal.current_status === 'Retired' ? <View style={styles.retiredNotice}><Ionicons name="archive-outline" size={20} color={colors.danger} /><Text style={styles.retiredNoticeText}>RETIRED · {animal.retire_reason}</Text></View> : <PrimaryButton label="Retire Animal" icon="archive-outline" variant="danger" onPress={() => setRetireOpen(true)} />}</View>
        </ScrollView>
      </View>
      <Modal visible={serviceForm !== null} transparent animationType="slide" onRequestClose={() => setServiceForm(null)}><View style={styles.modalBackdrop}><View style={styles.modalPanel}><View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>{serviceForm === 'ai' ? 'AI & BREEDING' : 'HEALTH & VACCINATION'}</Text><Text style={styles.modalTitle}>{serviceForm === 'ai' ? 'Add AI Record' : 'Add Health Record'}</Text></View><Pressable accessibilityRole="button" onPress={() => setServiceForm(null)} style={styles.modalClose}><Ionicons name="close" size={22} color={colors.text} /></Pressable></View>{serviceForm === 'ai' ? <><TextField label="Bull breed / sire" value={bullBreed} onChangeText={setBullBreed} /><TextField label="Semen straw code" value={strawCode} onChangeText={setStrawCode} /></> : <TextField label="Vaccine or treatment" value={healthItem} onChangeText={setHealthItem} placeholder="FMD-Raksha" />}<TextField label="Technician / veterinarian" value={serviceBy} onChangeText={setServiceBy} /><TextField label="Details (optional)" value={serviceDetails} onChangeText={setServiceDetails} placeholder="Add notes for the service history" multiline /><PrimaryButton label="Save Service Record" icon="checkmark" onPress={handleSaveService} /></View></View></Modal>
      <Modal visible={retireOpen} transparent animationType="fade" onRequestClose={() => setRetireOpen(false)}><View style={styles.modalBackdrop}><View style={styles.modalPanel}><View style={styles.modalIcon}><Ionicons name="warning-outline" size={25} color={colors.danger} /></View><Text style={styles.modalTitle}>Retire this animal?</Text><Text style={styles.modalBody}>This changes the lifecycle status but preserves {formatMoozzleId(animal.moozzle_id)} forever.</Text><Text style={styles.formLabel}>Required reason</Text><View style={styles.reasonRow}><OptionChip label="Death" selected={retireReason === 'Death'} onPress={() => setRetireReason('Death')} /><OptionChip label="Permanent Sale / Transfer" selected={retireReason === 'Permanent Sale / Transfer'} onPress={() => setRetireReason('Permanent Sale / Transfer')} /></View><OptionChip label="Transfer to Another State" selected={retireReason === 'Transfer to Another State'} onPress={() => setRetireReason('Transfer to Another State')} /><TextField label="Notes (optional)" value={retireNotes} onChangeText={setRetireNotes} multiline placeholder="Add an audit note" /><View style={styles.modalActions}><PrimaryButton label="Keep Active" onPress={() => setRetireOpen(false)} variant="outline" style={styles.modalAction} /><PrimaryButton label="Confirm Retirement" onPress={handleRetire} variant="danger" style={styles.modalAction} /></View></View></View></Modal>
    </AppScreen>
  );
}

function ProfileHero({ animal, onCopy }: { animal: Animal; onCopy: () => void }) {
  return <Card style={styles.heroCard}><View style={styles.heroTop}><View style={styles.heroIdBlock}><Text style={styles.heroKicker}>MOOZZLE ID</Text><Text selectable style={styles.heroId}>{formatMoozzleId(animal.moozzle_id)}</Text><View style={styles.heroPills}><Pill label={animal.current_status} tone={animal.current_status === 'Active' ? 'green' : 'red'} /><Pill label={animal.biometric_status} tone="blue" /></View></View><Pressable accessibilityRole="button" onPress={onCopy} style={styles.copyButton}><Ionicons name="copy-outline" size={18} color={colors.primary} /><Text style={styles.copyLabel}>Copy ID</Text></Pressable></View><View style={styles.heroPhotoRow}><AnimalPhoto animal={animal} size={128} /><View style={styles.photoDetails}><Text style={styles.heroSpecies}>{animal.animal_type} — {animal.breed}</Text><Text style={styles.referenceLabel}>Stored reference image</Text><Text style={styles.captureDate}>Captured {formatDate(animal.registration_date)}</Text><Text style={styles.templateLabel}>Template {animal.biometric_template_id}</Text></View></View><View style={styles.demographicsGrid}><DemoItem label="Age" value={`${animal.age_years} years`} /><DemoItem label="Sex" value={animal.sex} /><DemoItem label="Owner" value={animal.owner_name} /><DemoItem label="Location" value={`${animal.village}, ${animal.district}`} /><DemoItem label="State" value={animal.state} /><DemoItem label="Enrolled by" value="AI Tech Ramesh" /></View></Card>;
}

function DemoItem({ label, value }: { label: string; value: string }) { return <View style={styles.demoItem}><Text style={styles.demoLabel}>{label}</Text><Text style={styles.demoValue}>{value}</Text></View>; }

function OverviewPanel({ animal }: { animal: Animal }) {
  return <View style={styles.panelStack}><Card style={styles.infoCard}><View style={styles.panelTitleRow}><Ionicons name="finger-print-outline" size={21} color={colors.blue} /><Text style={styles.panelTitle}>Biometric template</Text></View><View style={styles.metricGrid}><DemoItem label="Template ID" value={animal.biometric_template_id} /><DemoItem label="Quality score" value="95% demo quality" /><DemoItem label="Model version" value="demo-v1.0" /><DemoItem label="Images enrolled" value={`${animal.captured_images_count} frames`} /></View></Card><View style={styles.disclaimer}><Ionicons name="information-circle-outline" size={18} color={colors.warning} /><Text style={styles.disclaimerText}>MOOZZLE is a prototype. Match scores and biometric performance have not been validated through field testing.</Text></View></View>;
}

function ServicePanel({ title, icon, records, empty, action, onAction }: { title: string; icon: keyof typeof Ionicons.glyphMap; records: { id: string; record_type: LivestockRecordType; date: string; performed_by: string; details: string; metadata: Record<string, string> }[]; empty: string; action: string; onAction: () => void }) {
  return <View style={styles.panelStack}><View style={styles.serviceHeading}><View style={styles.panelTitleRow}><Ionicons name={icon} size={21} color={colors.primary} /><Text style={styles.panelTitle}>{title}</Text></View><Pressable accessibilityRole="button" onPress={onAction} style={styles.addButton}><Ionicons name="add" size={17} color={colors.primary} /><Text style={styles.addButtonText}>{action}</Text></Pressable></View>{records.length === 0 ? <Card><Text style={styles.emptyService}>{empty}</Text></Card> : records.map((record) => <ServiceRecordCard key={record.id} record={record} />)}</View>;
}

function ServiceRecordCard({ record }: { record: { id: string; record_type: LivestockRecordType; date: string; performed_by: string; details: string; metadata: Record<string, string> } }) {
  const meta = Object.entries(record.metadata);
  return <Card style={styles.serviceCard}><View style={styles.serviceTop}><Pill label={record.record_type} tone={record.record_type === 'Artificial Insemination' ? 'blue' : 'green'} /><Text style={styles.serviceDate}>{formatDate(record.date)}</Text></View><Text style={styles.serviceDetails}>{record.details}</Text><Text style={styles.serviceBy}>Performed by {record.performed_by}</Text>{meta.length > 0 && <View style={styles.metaRow}>{meta.map(([key, value]) => <View style={styles.metaItem} key={key}><Text style={styles.metaKey}>{key.replace(/_/g, ' ')}</Text><Text style={styles.metaValue}>{value}</Text></View>)}</View>}</Card>;
}

function InsurancePanel({ animal, record }: { animal: Animal; record?: { metadata: Record<string, string>; details: string; date: string; performed_by: string } }) {
  return <View style={styles.panelStack}><Card style={styles.insuranceCard}><View style={styles.panelTitleRow}><Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} /><Text style={styles.panelTitle}>Insurance policy</Text></View><View style={styles.insuranceGrid}><DemoItem label="Policy number" value={record?.metadata.policy_no ?? 'MOOZ-INS-8819'} /><DemoItem label="Insurer" value="National Livestock Cover" /><DemoItem label="Sum insured" value="₹65,000" /><DemoItem label="Coverage status" value={record?.metadata.coverage_status ?? 'Active'} /></View><View style={styles.inspection}><Text style={styles.demoLabel}>Latest inspection</Text><Text style={styles.inspectionText}>{record?.details ?? 'Annual inspection is due after the next service visit.'}</Text><Text style={styles.serviceBy}>{record ? `${formatDate(record.date)} · ${record.performed_by}` : `Policy linked to ${animal.owner_name}`}</Text></View></Card></View>;
}

function TraceabilityPanel({ animal, records }: { animal: Animal; records: { id: string; record_type: LivestockRecordType; date: string; details: string }[] }) {
  const events = [{ date: animal.registration_date, title: 'Enrolment', detail: `Identity assigned by AI Tech Ramesh` }, ...records.map((record) => ({ date: record.date, title: record.record_type, detail: record.details }))].sort((a, b) => b.date.localeCompare(a.date));
  return <View style={styles.panelStack}><Card style={styles.timelineCard}><View style={styles.panelTitleRow}><Ionicons name="git-branch-outline" size={21} color={colors.primary} /><Text style={styles.panelTitle}>Lifecycle timeline</Text></View>{events.map((event, index) => <View style={styles.timelineRow} key={`${event.date}-${event.title}`}><View style={styles.timelineRail}><View style={styles.timelineDot} />{index < events.length - 1 && <View style={styles.timelineLine} />}</View><View style={styles.timelineCopy}><Text style={styles.timelineDate}>{formatDate(event.date)}</Text><Text style={styles.timelineTitle}>{event.title}</Text><Text style={styles.timelineDetail}>{event.detail}</Text></View></View>)}</Card></View>;
}

function formatDate(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }

const styles = StyleSheet.create({
  pageBody: { flex: 1 },
  flex: { flex: 1 },
  topBar: { minHeight: 56, paddingHorizontal: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: 135 },
  backText: { color: colors.text, fontFamily: Fonts.medium, fontSize: 12 },
  topId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 12, fontVariant: ['tabular-nums'] },
  shareButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 35, gap: 14 },
  notice: { minHeight: 42, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 7 },
  noticeText: { color: colors.primary, fontFamily: Fonts.medium, fontSize: 12, flex: 1 },
  heroCard: { gap: 17 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroIdBlock: { gap: 4 },
  heroKicker: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  heroId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 23, fontVariant: ['tabular-nums'], letterSpacing: 0.6 },
  heroPills: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 2 },
  copyButton: { minHeight: 44, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 5 },
  copyLabel: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11 },
  heroPhotoRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  photoDetails: { flex: 1, gap: 5 },
  heroSpecies: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  referenceLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  captureDate: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  templateLabel: { color: colors.blue, fontFamily: Fonts.medium, fontSize: 10 },
  demographicsGrid: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, flexDirection: 'row', flexWrap: 'wrap', rowGap: 15 },
  demoItem: { width: '50%', gap: 4 },
  demoLabel: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11, textTransform: 'capitalize' },
  demoValue: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  tabScroller: { marginHorizontal: -14 },
  tabScroll: { flexGrow: 0 },
  profileTabs: { paddingHorizontal: 14, gap: 8 },
  profileTab: { minHeight: 42, paddingHorizontal: 13, borderRadius: 10, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  profileTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  profileTabText: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12 },
  profileTabTextActive: { color: colors.surface },
  panelStack: { gap: 12 },
  infoCard: { gap: 15 },
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  serviceHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  addButton: { minHeight: 44, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 3 },
  addButtonText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11 },
  emptyService: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  serviceCard: { gap: 9 },
  serviceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  serviceDate: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11 },
  serviceDetails: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13, lineHeight: 18 },
  serviceBy: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  metaRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9, flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  metaItem: { width: '50%', gap: 2 },
  metaKey: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 10, textTransform: 'capitalize' },
  metaValue: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 11 },
  insuranceCard: { gap: 16 },
  insuranceGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  inspection: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 13, gap: 5 },
  inspectionText: { color: colors.text, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  timelineCard: { gap: 15 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineRail: { width: 18, alignItems: 'center' },
  timelineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, marginTop: 3 },
  timelineLine: { width: 2, backgroundColor: '#B7D8BE', flex: 1, marginTop: 3 },
  timelineCopy: { flex: 1, gap: 3, paddingBottom: 15 },
  timelineDate: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 10 },
  timelineTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  timelineDetail: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  retireSection: { gap: 9, paddingTop: 5 },
  retireTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  retireText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  retiredNotice: { borderRadius: 12, backgroundColor: colors.dangerLight, minHeight: 48, paddingHorizontal: 13, flexDirection: 'row', gap: 8, alignItems: 'center' },
  retiredNoticeText: { color: colors.danger, fontFamily: Fonts.bold, fontSize: 12, flex: 1 },
  disclaimer: { flexDirection: 'row', gap: 7, backgroundColor: colors.warningLight, padding: 11, borderRadius: 10, alignItems: 'flex-start' },
  disclaimerText: { color: '#845A1A', flex: 1, fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  modalPanel: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 13 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  modalEyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  modalTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 21, marginTop: 3 },
  modalClose: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modalIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  modalBody: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  formLabel: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  reasonRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  modalActions: { flexDirection: 'row', gap: 9, marginTop: 5 },
  modalAction: { flex: 1, paddingHorizontal: 7 },
});
