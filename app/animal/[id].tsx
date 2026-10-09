import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormSheet, SERVICE_FORMS, type FieldSpec, type FormSpec, type FormSubmit } from '@/components/record-forms';
import { AnimalPhoto, approvalTone, Card, colors, DataGate, EmptyState, ErrorState, formatMoozzleId, Pill, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { allows, canRequestService, canWriteService, LIMITED_HEALTH_TITLES, type Role, type ServiceKind } from '@/lib/rbac';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import {
  addServiceRecord,
  createRequest,
  logAudit,
  messageOf,
  retireAnimal,
  reviewAnimal,
  submitDraft,
  useBovineData,
  useBovineStore,
  useSession,
} from '@/store/useBovineStore';
import type { Animal, AuditRow, LivestockServiceRecord } from '@/store/types';

type TabKey = 'identity' | 'health' | 'breeding' | 'insurance' | 'movement' | 'operations' | 'documents' | 'activity';

const TAB_LABELS: Record<TabKey, string> = {
  identity: 'Identity',
  health: 'Health',
  breeding: 'Breeding',
  insurance: 'Insurance',
  movement: 'Movement',
  operations: 'Operations',
  documents: 'Documents',
  activity: 'Activity History',
};

const TAB_RESOURCE: Record<TabKey, string> = {
  identity: 'Animal identity',
  health: 'Health and clinical records',
  breeding: 'Artificial insemination records',
  insurance: 'Insurance records',
  movement: 'Movement and traceability records',
  operations: 'Farm operations records',
  documents: 'Animal documents',
  activity: 'Activity history',
};

type Sheet =
  | { kind: 'service'; service: ServiceKind; correct?: LivestockServiceRecord }
  | { kind: 'retire' }
  | { kind: 'transfer' }
  | { kind: 'correction' }
  | { kind: 'help'; request: 'vet_help' | 'ai_service' }
  | { kind: 'review'; decision: 'Approved' | 'Rejected' }
  | null;

export default function AnimalProfileScreen() {
  return (
    <DataGate>
      <AnimalProfileContent />
    </DataGate>
  );
}

function tabAccess(role: Role, permissions: ReturnType<typeof useSession>['permissions']): Record<TabKey, boolean> {
  return {
    identity: true,
    health: allows(permissions.health_records),
    breeding: allows(permissions.artificial_insemination),
    insurance: allows(permissions.insurance_records),
    movement: allows(permissions.view_animal_profile),
    operations: role === 'Farm Manager' || role === 'Farmer' || role === 'Organisation Administrator' || role === 'Super Administrator',
    documents: allows(permissions.view_animal_profile),
    activity: allows(permissions.view_audit_logs),
  };
}

function AnimalProfileContent() {
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const role = session.role as Role;
  const { animals, records: allRecords } = useBovineData();
  const policies = useBovineStore((state) => state.policyRows);
  const requests = useBovineStore((state) => state.requestRows);
  const animal = useMemo(() => animals.find((item) => item.moozzle_id === params.id), [animals, params.id]);
  const records = useMemo(() => allRecords.filter((item) => item.animal_id === animal?.id), [allRecords, animal?.id]);
  const access = useMemo(() => tabAccess(role, session.permissions), [role, session.permissions]);
  const requestedTab = (params.tab && params.tab in TAB_LABELS ? params.tab : 'identity') as TabKey;
  const [tab, setTab] = useState<TabKey>(requestedTab);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const viewed = useRef<string | null>(null);
  const sensitiveViewed = useRef(false);

  useEffect(() => {
    if (animal && viewed.current !== animal.moozzle_id) {
      viewed.current = animal.moozzle_id;
      void logAudit('record.view', animal.moozzle_id, `Profile opened as ${role}`, 'success');
    }
  }, [animal, role]);
  useEffect(() => {
    if (animal && tab === 'health' && access.health && !sensitiveViewed.current) {
      sensitiveViewed.current = true;
      void logAudit('record.view_sensitive', animal.moozzle_id, 'Health records viewed', 'success');
    }
  }, [access.health, animal, tab]);

  const openTab = useCallback((key: TabKey) => {
    if (!access[key]) {
      router.push({ pathname: '/permission-denied', params: { resource: TAB_RESOURCE[key], target: params.id } });
      return;
    }
    setTab(key);
  }, [access, params.id]);

  const done = useCallback((message: string) => {
    setSheet(null);
    setNotice(message);
    setError('');
  }, []);

  if (!access[requestedTab]) {
    return <Redirect href={{ pathname: '/permission-denied', params: { resource: TAB_RESOURCE[requestedTab], target: params.id } }} />;
  }
  if (!animal) {
    // Never confirm whether an out-of-scope record exists.
    return <ErrorState message="This MOOZZLE ID is not in your authorised records. It may be outside your scope or not yet synced." onRetry={() => router.back()} />;
  }

  const animalPolicies = policies.filter((policy) => policy.animal_id === animal.id);
  const animalRequests = requests.filter((request) => request.animal_id === animal.id);
  const byType = (type: ServiceKind) => records.filter((record) => record.service_type === type);
  const retired = animal.current_status === 'Retired';
  const isCreator = animal.created_by === session.userId;
  const canReview = !isCreator && (animal.approval_status === 'Submitted' || animal.approval_status === 'Pending Review') && ((role === 'Organisation Administrator' && animal.organisation_id === session.scope?.organisation_id) || role === 'Government Officer' || (role === 'Super Administrator' && session.privileged));
  const retireLevel = session.permissions.retire_animal;
  const transferLevel = session.permissions.ownership_transfer;
  const canTransfer = !retired && (transferLevel === 'Own request' ? role === 'Farmer' && animal.owner_user_id === session.userId : allows(transferLevel)) && role !== 'Livestock Inspector' && role !== 'Government Officer';

  const writeService = (service: ServiceKind) => !retired && !animal.pending_sync && canWriteService(role, service, session.privileged) && animal.approval_status !== 'Draft';
  const serviceSpecs = (service: ServiceKind): FormSpec[] => {
    const specs = SERVICE_FORMS[service];
    if (service === 'health' && role === 'Farm Manager') return specs.filter((spec) => spec.title === 'Vaccination' || spec.title === 'Deworming');
    return specs;
  };

  const handleService = async (service: ServiceKind, data: FormSubmit, correct?: LivestockServiceRecord) => {
    const details: Record<string, string> = { ...data.values };
    if (correct) details.correction_reason = data.values.correction_reason ?? '';
    const result = await addServiceRecord({ animalId: animal.id, moozzleId: animal.moozzle_id, serviceType: service, title: data.title, technicianName: session.name, details, correctsId: correct?.id ?? null });
    done(result.queued ? 'Saved on this device. It will be re-checked and uploaded on the next sync.' : correct ? 'Signed amendment saved. The original record is preserved.' : role === 'Farmer' ? 'Your record has been saved.' : 'Signed record saved and added to the audit trail.');
  };

  const sheetView = (() => {
    if (!sheet) return null;
    switch (sheet.kind) {
      case 'service': {
        const correctionField: FieldSpec[] = sheet.correct ? [{ key: 'correction_reason', label: 'Reason for amendment', required: true, placeholder: 'What was wrong in the original record?' }] : [];
        const specs = sheet.correct ? serviceSpecs(sheet.service).filter((spec) => spec.title === sheet.correct?.record_type) : serviceSpecs(sheet.service);
        return (
          <FormSheet
            visible
            heading={sheet.correct ? `Amend signed ${sheet.correct.record_type}` : `New ${sheet.service === 'ai' ? 'breeding' : sheet.service} record`}
            specs={specs.length ? specs : serviceSpecs(sheet.service)}
            extraFields={correctionField}
            submitLabel={sheet.correct ? 'Sign Amendment' : 'Sign & Save'}
            confirmText={`Signed as ${session.name} (${role}). Signed records cannot be edited; corrections are added as amendments.`}
            onClose={() => setSheet(null)}
            onSubmit={(data) => handleService(sheet.service, data, sheet.correct)}
          />
        );
      }
      case 'retire':
        return (
          <FormSheet
            visible
            heading={retireLevel === 'Request only' ? 'Request retirement' : 'Retire animal'}
            specs={[{ title: 'Retire', fields: [{ key: 'reason', label: 'Reason', required: true, placeholder: 'e.g. Died — natural causes, Sold outside programme' }] }]}
            submitLabel={retireLevel === 'Request only' ? 'Send Request' : 'Retire Permanently'}
            danger
            confirmText={retireLevel === 'Request only' ? 'Your request goes to an authorised reviewer. The MOOZZLE ID is never deleted.' : 'The MOOZZLE ID is retired permanently and cannot be reassigned. History is preserved and the action is audited.'}
            onClose={() => setSheet(null)}
            onSubmit={async (data) => {
              const outcome = await retireAnimal(animal.id, animal.moozzle_id, data.values.reason ?? '');
              done(outcome === 'retired' ? 'Animal retired. The identity and history are preserved.' : 'Retirement request sent for approval.');
            }}
          />
        );
      case 'transfer':
        return (
          <FormSheet
            visible
            heading="Request ownership transfer"
            specs={[{ title: 'Transfer', fields: [{ key: 'new_owner_name', label: 'New owner name', required: true }, { key: 'new_owner_phone', label: 'New owner mobile', keyboard: 'phone-pad' }, { key: 'new_owner_email', label: 'New owner MOOZZLE email (optional)', keyboard: 'email-address' }, { key: 'note', label: 'Note', multiline: true }] }]}
            submitLabel="Submit Request"
            confirmText="An independent inspector or administrator must approve the transfer. You cannot approve your own request."
            onClose={() => setSheet(null)}
            onSubmit={async (data) => {
              await createRequest('transfer', animal.id, animal.moozzle_id, data.values);
              done('Ownership transfer request submitted for independent approval.');
            }}
          />
        );
      case 'correction':
        return (
          <FormSheet
            visible
            heading="Request a correction"
            specs={[{ title: 'Correction', fields: [{ key: 'note', label: 'What is incorrect?', required: true, multiline: true }, { key: 'breed', label: 'Correct breed (optional)' }, { key: 'age_years', label: 'Correct age in years (optional)', keyboard: 'numeric' }, { key: 'village', label: 'Correct village (optional)' }] }]}
            submitLabel="Send Request"
            confirmText="The permanent MOOZZLE ID and biometric template cannot be changed. An administrator reviews other corrections."
            onClose={() => setSheet(null)}
            onSubmit={async (data) => {
              await createRequest('correction', animal.id, animal.moozzle_id, data.values);
              done('Correction request sent to your organisation administrator.');
            }}
          />
        );
      case 'help':
        return (
          <FormSheet
            visible
            heading={sheet.request === 'vet_help' ? 'Get veterinary help' : 'Request AI service'}
            specs={[{ title: 'Request', fields: [{ key: 'note', label: sheet.request === 'vet_help' ? 'What is wrong?' : 'Heat observed / preferred time', required: true, multiline: true }, { key: 'urgency', label: 'Urgency (Normal / Urgent)', placeholder: 'Normal' }] }]}
            submitLabel="Send Request"
            onClose={() => setSheet(null)}
            onSubmit={async (data) => {
              await createRequest(sheet.request, animal.id, animal.moozzle_id, data.values);
              done(sheet.request === 'vet_help' ? 'Your request has been sent to the veterinarian.' : 'Your request has been sent to the AI technician.');
            }}
          />
        );
      case 'review':
        return (
          <FormSheet
            visible
            heading={sheet.decision === 'Approved' ? 'Approve registration' : 'Reject registration'}
            specs={[{ title: 'Review', fields: [{ key: 'note', label: 'Review note', required: sheet.decision === 'Rejected', multiline: true }] }]}
            submitLabel={sheet.decision === 'Approved' ? 'Approve' : 'Reject'}
            danger={sheet.decision === 'Rejected'}
            onClose={() => setSheet(null)}
            onSubmit={async (data) => {
              await reviewAnimal(animal.id, sheet.decision, data.values.note ?? '', animal.moozzle_id);
              done(`Registration ${sheet.decision.toLowerCase()}.`);
            }}
          />
        );
      default:
        return null;
    }
  })();

  const runAction = async (action: () => Promise<void>, message: string) => {
    setError('');
    try {
      await action();
      setNotice(message);
    } catch (caught) {
      console.error('Animal action failed', caught);
      setError(messageOf(caught, 'This action could not be completed.'));
    }
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/records'))} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
        <View style={styles.flex}>
          <Text style={styles.topKicker}>MOOZZLE ID</Text>
          <Text selectable style={styles.topId}>{formatMoozzleId(animal.moozzle_id)}</Text>
        </View>
        <Pill label={animal.approval_status} tone={approvalTone(animal.approval_status)} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabs}>
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key, disabled: !access[key] }} accessibilityLabel={access[key] ? TAB_LABELS[key] : `${TAB_LABELS[key]} (restricted)`} onPress={() => openTab(key)} style={[styles.tab, tab === key && styles.tabActive, !access[key] && styles.tabLocked]}>
            {!access[key] ? <Ionicons name="lock-closed" size={12} color={colors.muted} /> : null}
            <Text style={[styles.tabText, tab === key && styles.tabTextActive, !access[key] && styles.tabTextLocked]}>{TAB_LABELS[key]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.flex} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {notice ? <Banner tone="green" text={notice} onClose={() => setNotice('')} /> : null}
        {error ? <Banner tone="red" text={error} onClose={() => setError('')} /> : null}

        {tab === 'identity' ? (
          <IdentityTab
            animal={animal}
            role={role}
            canReview={canReview}
            canRetire={retireLevel !== 'No' && !retired && !animal.pending_sync && animal.approval_status !== 'Draft'}
            retireLabel={retireLevel === 'Request only' ? 'Request Retirement' : 'Retire Animal'}
            canTransfer={canTransfer}
            canHelp={canRequestService(role) && !retired && animal.approval_status !== 'Draft'}
            isCreator={isCreator}
            openRequests={animalRequests.filter((request) => request.status === 'Submitted').length}
            onSheet={setSheet}
            onSubmitDraft={() => void runAction(() => submitDraft(animal.id, animal.moozzle_id), 'Draft submitted for approval.')}
          />
        ) : null}
        {tab === 'health' ? (
          <RecordList
            title="Health & Medical"
            records={byType('health')}
            empty="No health records you are authorised to see."
            note={session.permissions.health_records === 'Limited' ? `Your role sees preventive and reproductive entries only (${LIMITED_HEALTH_TITLES.join(', ')}). Clinical diagnoses and prescriptions are restricted.` : undefined}
            canAdd={writeService('health')}
            addLabel={role === 'Farm Manager' ? 'Record Vaccination' : 'Add Medical Record'}
            onAdd={() => setSheet({ kind: 'service', service: 'health' })}
            canAmend={role === 'Veterinarian' && !retired}
            onAmend={(record) => setSheet({ kind: 'service', service: 'health', correct: record })}
          />
        ) : null}
        {tab === 'breeding' ? (
          <RecordList
            title="Artificial Insemination & Breeding"
            records={byType('ai')}
            empty="No breeding records yet."
            canAdd={writeService('ai')}
            addLabel="Record Artificial Insemination"
            onAdd={() => setSheet({ kind: 'service', service: 'ai' })}
            canAmend={(role === 'AI Technician' || role === 'Veterinarian') && !retired}
            onAmend={(record) => setSheet({ kind: 'service', service: 'ai', correct: record })}
          />
        ) : null}
        {tab === 'insurance' ? (
          <View style={styles.stack}>
            <Text style={styles.sectionTitle}>Insurance</Text>
            {animalPolicies.length === 0 ? <EmptyState title="No linked policy" message="No insurance policy you are authorised to see is linked to this animal." /> : null}
            {animalPolicies.map((policy) => (
              <Card key={policy.id} style={styles.policy}>
                <View style={styles.rowBetween}><Text selectable style={styles.policyNo}>{policy.policy_number}</Text><Pill label={policy.verification_status} tone={policy.verification_status === 'Verified' ? 'green' : policy.verification_status === 'Pending' ? 'amber' : 'red'} /></View>
                <Detail label="Policy holder" value={policy.holder_name} />
                <Detail label="Coverage" value={`₹${policy.coverage_amount.toLocaleString('en-IN')}`} />
                <Detail label="Valid" value={`${policy.start_date} → ${policy.end_date}`} />
                <Detail label="Claim status" value={policy.claim_status} />
                {role === 'Insurance Officer' ? <PrimaryButton label="Verify Identity for this Policy" icon="shield-checkmark-outline" onPress={() => router.push({ pathname: '/verify', params: { policy: policy.id } })} /> : null}
              </Card>
            ))}
            <RecordList title="Verification log" records={byType('insurance')} empty="No identity verifications recorded." canAdd={false} />
          </View>
        ) : null}
        {tab === 'movement' ? (
          <RecordList title="Traceability & Movement" records={byType('traceability')} empty="No movement or inspection events." canAdd={writeService('traceability')} addLabel="Record Movement / Inspection" onAdd={() => setSheet({ kind: 'service', service: 'traceability' })} />
        ) : null}
        {tab === 'operations' ? (
          <RecordList title="Daily Operations" records={byType('operations')} empty="No milk or feed records." canAdd={writeService('operations')} addLabel="Record Milk / Feed" onAdd={() => setSheet({ kind: 'service', service: 'operations' })} />
        ) : null}
        {tab === 'documents' ? <DocumentsTab animal={animal} policies={animalPolicies.map((policy) => policy.policy_number)} /> : null}
        {tab === 'activity' ? <ActivityTab moozzleId={animal.moozzle_id} /> : null}
      </ScrollView>
      {sheetView}
    </View>
  );
}

function Banner({ tone, text, onClose }: { tone: 'green' | 'red'; text: string; onClose: () => void }) {
  return (
    <View style={[styles.banner, tone === 'red' && styles.bannerRed]}>
      <Ionicons name={tone === 'green' ? 'checkmark-circle' : 'alert-circle'} size={18} color={tone === 'green' ? colors.primaryDark : colors.danger} />
      <Text selectable style={styles.bannerText}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onClose} hitSlop={8}><Ionicons name="close" size={16} color={colors.muted} /></Pressable>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
}

function IdentityTab({ animal, role, canReview, canRetire, retireLabel, canTransfer, canHelp, isCreator, openRequests, onSheet, onSubmitDraft }: {
  animal: Animal;
  role: Role;
  canReview: boolean;
  canRetire: boolean;
  retireLabel: string;
  canTransfer: boolean;
  canHelp: boolean;
  isCreator: boolean;
  openRequests: number;
  onSheet: (sheet: Sheet) => void;
  onSubmitDraft: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Card style={styles.hero}>
        <AnimalPhoto animal={animal} size={92} />
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>{animal.breed} {animal.animal_type}</Text>
          <Text style={styles.heroMeta}>{animal.sex} · {animal.age_years} years</Text>
          <View style={styles.pills}>
            <Pill label={animal.current_status} tone={animal.current_status === 'Active' ? 'green' : 'slate'} />
            <Pill label={`Biometric: ${animal.biometric_status}`} tone={animal.biometric_status === 'Enrolled' ? 'blue' : 'amber'} />
            {animal.pending_sync ? <Pill label="Waiting to sync" tone="amber" /> : null}
          </View>
        </View>
      </Card>
      {animal.duplicate_of ? <View style={styles.warn}><Ionicons name="copy-outline" size={18} color={colors.danger} /><Text style={styles.warnText}>Possible duplicate identity. Sent for manual review — records are never merged automatically.</Text></View> : null}
      {animal.review_note ? <View style={styles.info}><Text style={styles.infoText}>Reviewer note: {animal.review_note}</Text></View> : null}
      <Card style={styles.details}>
        <Detail label="Species" value={animal.animal_type} />
        <Detail label="Farm" value={animal.farm_name} />
        <Detail label="Location" value={[animal.village, animal.district, animal.state].filter(Boolean).join(', ')} />
        <Detail label="Registered" value={new Date(animal.registration_date).toLocaleDateString()} />
        <Detail label="Muzzle captures" value={`${animal.captured_images_count} images (template stored securely, not shown)`} />
        {animal.owner_visible ? (
          <>
            <Detail label="Owner" value={animal.owner_name} />
            <Detail label="Owner mobile" value={animal.owner_phone} />
          </>
        ) : (
          <View style={styles.locked}><Ionicons name="lock-closed-outline" size={14} color={colors.muted} /><Text style={styles.lockedText}>Owner personal details are not shared with the {role} role.</Text></View>
        )}
        {animal.retire_reason ? <Detail label="Retired" value={`${animal.retire_reason}${animal.retire_date ? ` · ${new Date(animal.retire_date).toLocaleDateString()}` : ''}`} /> : null}
      </Card>
      {openRequests > 0 ? <Text style={styles.muted}>{openRequests} request{openRequests === 1 ? '' : 's'} awaiting review for this animal.</Text> : null}
      <View style={styles.actions}>
        {isCreator && animal.approval_status === 'Draft' && !animal.pending_sync ? <PrimaryButton label="Submit Draft for Approval" icon="send-outline" onPress={onSubmitDraft} /> : null}
        {canReview ? (
          <View style={styles.row}>
            <PrimaryButton label="Approve" icon="checkmark" onPress={() => onSheet({ kind: 'review', decision: 'Approved' })} style={styles.flex} />
            <PrimaryButton label="Reject" icon="close" variant="danger" onPress={() => onSheet({ kind: 'review', decision: 'Rejected' })} style={styles.flex} />
          </View>
        ) : null}
        {canHelp ? <PrimaryButton label="Get Veterinary Help" icon="medkit-outline" variant="blue" onPress={() => onSheet({ kind: 'help', request: 'vet_help' })} /> : null}
        {canHelp ? <PrimaryButton label="Request AI Service" icon="flask-outline" variant="outline" onPress={() => onSheet({ kind: 'help', request: 'ai_service' })} /> : null}
        {canTransfer ? <PrimaryButton label="Request Ownership Transfer" icon="swap-horizontal-outline" variant="outline" onPress={() => onSheet({ kind: 'transfer' })} /> : null}
        {!animal.pending_sync && animal.approval_status !== 'Draft' && role !== 'Researcher' ? <PrimaryButton label="Request Correction" icon="create-outline" variant="soft" onPress={() => onSheet({ kind: 'correction' })} /> : null}
        {canRetire ? <PrimaryButton label={retireLabel} icon="archive-outline" variant="danger" onPress={() => onSheet({ kind: 'retire' })} /> : null}
      </View>
    </View>
  );
}

function RecordList({ title, records, empty, note, canAdd, addLabel, onAdd, canAmend = false, onAmend }: {
  title: string;
  records: LivestockServiceRecord[];
  empty: string;
  note?: string;
  canAdd: boolean;
  addLabel?: string;
  onAdd?: () => void;
  canAmend?: boolean;
  onAmend?: (record: LivestockServiceRecord) => void;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {note ? <View style={styles.info}><Ionicons name="eye-off-outline" size={15} color={colors.blue} /><Text style={styles.infoText}>{note}</Text></View> : null}
      {canAdd && addLabel && onAdd ? <PrimaryButton label={addLabel} icon="add" onPress={onAdd} /> : null}
      {records.length === 0 ? <EmptyState title="Nothing recorded" message={empty} /> : null}
      {records.map((record) => (
        <Card key={record.id} style={[styles.record, record.corrected_by && styles.recordCorrected]}>
          <View style={styles.rowBetween}>
            <Text style={styles.recordTitle}>{record.record_type}</Text>
            <Text style={styles.recordDate}>{record.date}</Text>
          </View>
          <Text selectable style={styles.recordBody}>{record.details}</Text>
          {Object.entries(record.metadata).filter(([key]) => key !== 'correction_reason').map(([key, value]) => (
            <Text key={key} selectable style={styles.recordMeta}><Text style={styles.recordMetaKey}>{key.replace(/_/g, ' ')}: </Text>{value}</Text>
          ))}
          {record.metadata.correction_reason ? <Text style={styles.amend}>Amendment · {record.metadata.correction_reason}</Text> : null}
          <View style={styles.rowBetween}>
            <Text style={styles.signed}><Ionicons name="ribbon-outline" size={12} color={colors.muted} /> Signed by {record.performed_by || 'unknown'}{record.performer_role ? ` · ${record.performer_role}` : ''}</Text>
            {record.pending_sync ? <Pill label="Waiting to sync" tone="amber" /> : record.corrected_by ? <Pill label="Corrected" tone="slate" /> : canAmend && onAmend ? (
              <Pressable accessibilityRole="button" onPress={() => onAmend(record)} hitSlop={8} style={styles.amendButton}><Text style={styles.amendButtonText}>Amend</Text></Pressable>
            ) : null}
          </View>
        </Card>
      ))}
    </View>
  );
}

function DocumentsTab({ animal, policies }: { animal: Animal; policies: string[] }) {
  const [message, setMessage] = useState('');
  const certificate = [
    'MOOZZLE — Certificate of Biometric Registration',
    `MOOZZLE ID: ${formatMoozzleId(animal.moozzle_id)}`,
    `Animal: ${animal.breed} ${animal.animal_type}, ${animal.sex}, ${animal.age_years} yrs`,
    `Farm: ${animal.farm_name || '—'} · ${[animal.village, animal.district, animal.state].filter(Boolean).join(', ')}`,
    `Registered: ${new Date(animal.registration_date).toLocaleDateString()} · Status: ${animal.approval_status}`,
    'One Muzzle. One Identity. One Digital Record.',
  ].join('\n');
  const share = useCallback(async () => {
    setMessage('');
    try {
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(certificate);
        setMessage('Certificate text copied to the clipboard.');
      } else {
        await Share.share({ message: certificate });
      }
      void logAudit('export.records', animal.moozzle_id, 'Registration certificate shared', 'success');
    } catch (caught) {
      console.error('Certificate share failed', caught);
      setMessage('Sharing is unavailable here. The certificate text is selectable above.');
    }
  }, [animal.moozzle_id, certificate]);
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>Documents</Text>
      <Card style={styles.certificate}>
        <Ionicons name="ribbon-outline" size={26} color={colors.primary} />
        <Text selectable style={styles.certText}>{certificate}</Text>
        <PrimaryButton label={Platform.OS === 'web' ? 'Copy Certificate' : 'Share Certificate'} icon="share-outline" variant="outline" onPress={() => void share()} />
        {message ? <Text style={styles.muted}>{message}</Text> : null}
      </Card>
      {policies.map((policy) => <Card key={policy}><Detail label="Insurance policy document" value={policy} /></Card>)}
      <Card><Detail label="Biometric enrolment" value={`${animal.captured_images_count} muzzle captures · ${animal.biometric_status}. Raw images and templates are restricted and never shown on ordinary screens.`} /></Card>
    </View>
  );
}

function ActivityTab({ moozzleId }: { moozzleId: string }) {
  const fetchRows = useCallback(async () => {
    const { data, error: queryError } = await supabase.from('audit_logs').select('id, event_id, user_id, user_role, action, target_moozzle_id, details, outcome, reason, source, created_at').eq('target_moozzle_id', moozzleId).order('created_at', { ascending: false }).limit(50);
    if (queryError) throw queryError;
    return (data ?? []) as AuditRow[];
  }, [moozzleId]);
  const { data: rows, error, reload } = useAsyncResource(fetchRows, 'Activity history could not be loaded.');
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>Activity History</Text>
      <Text style={styles.muted}>Audit events for this animal that your role may view.</Text>
      {error ? <View style={styles.stack}><Text selectable style={styles.errorText}>{error}</Text><PrimaryButton label="Retry" variant="outline" onPress={() => void reload()} /></View> : null}
      {!rows && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {rows?.length === 0 ? <EmptyState title="No activity visible" message="Your role has no visible audit events for this animal." /> : null}
      {rows?.map((row) => (
        <View key={row.id} style={styles.activityRow}>
          <View style={[styles.activityDot, row.outcome === 'denied' && styles.activityDotRed]} />
          <View style={styles.flex}>
            <Text style={styles.activityAction}>{row.action} · <Text style={styles.activityOutcome}>{row.outcome}</Text></Text>
            <Text style={styles.activityMeta}>{new Date(row.created_at).toLocaleString()} · {row.user_role || 'system'}</Text>
            {row.details ? <Text selectable style={styles.activityDetails}>{row.details}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  topKicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1 },
  topId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 20, fontVariant: ['tabular-nums'], letterSpacing: 0.6 },
  tabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { paddingHorizontal: 12, gap: 6, paddingBottom: 8 },
  tab: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLocked: { backgroundColor: colors.slateLight, borderStyle: 'dashed' },
  tabText: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  tabTextActive: { color: colors.surface },
  tabTextLocked: { color: colors.muted },
  content: { padding: 16, gap: 14, maxWidth: 820, width: '100%', alignSelf: 'center' },
  stack: { gap: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12 },
  bannerRed: { backgroundColor: colors.dangerLight },
  bannerText: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  heroTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 20 },
  heroMeta: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 14, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  warn: { flexDirection: 'row', gap: 8, backgroundColor: colors.dangerLight, borderRadius: 12, padding: 12 },
  warnText: { flex: 1, color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  info: { flexDirection: 'row', gap: 8, backgroundColor: colors.blueLight, borderRadius: 12, padding: 12 },
  infoText: { flex: 1, color: '#075985', fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  details: { gap: 10 },
  detail: { gap: 2 },
  detailLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  detailValue: { color: colors.text, fontFamily: Fonts.medium, fontSize: 15 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.slateLight, borderRadius: 10, padding: 10 },
  lockedText: { flex: 1, color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  actions: { gap: 10 },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 19 },
  record: { gap: 6 },
  recordCorrected: { opacity: 0.72 },
  recordTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  recordDate: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12, fontVariant: ['tabular-nums'] },
  recordBody: { color: colors.text, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  recordMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  recordMetaKey: { fontFamily: Fonts.semiBold, textTransform: 'capitalize' },
  amend: { color: colors.blue, fontFamily: Fonts.semiBold, fontSize: 12 },
  signed: { flex: 1, color: colors.muted, fontFamily: Fonts.medium, fontSize: 11 },
  amendButton: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.blueLight, justifyContent: 'center' },
  amendButtonText: { color: colors.blue, fontFamily: Fonts.bold, fontSize: 12 },
  policy: { gap: 10 },
  policyNo: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  certificate: { gap: 12, alignItems: 'flex-start' },
  certText: { color: colors.text, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 21 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  activityRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  activityDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
  activityDotRed: { backgroundColor: colors.danger },
  activityAction: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13 },
  activityOutcome: { color: colors.muted, fontFamily: Fonts.medium },
  activityMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  activityDetails: { color: colors.text, fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
});
