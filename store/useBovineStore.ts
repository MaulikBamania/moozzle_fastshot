import { AGE_MAX_MONTHS, AGE_MAX_YEARS } from '@/lib/age';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';
import { create } from 'zustand';
import { NO_PERMISSIONS, PERMISSIONS, isLevel, isRole, ROLE_EXPERIENCE, type PermissionMap, type Role } from '@/lib/rbac';
import { ENGINE_MODEL } from '@/lib/biometric/features';
import { animalTypeFromCode, deviceUtcOffsetMinutes, speciesCode } from '@/lib/demographics';
import { supabase } from '@/lib/supabase';
import { useAppStore } from './useAppStore';
import { isOnlineNow, useConnectivity } from './useConnectivity';
import type {
  MatchCandidate,
  QualityMetrics,
  Animal,
  AnimalRow,
  AgeGroup,
  AnimalType,
  FarmRow,
  GpsFix,
  LivestockServiceRecord,
  NotificationRow,
  OrganisationRow,
  OwnerRow,
  PolicyRow,
  PregnancyStatus,
  ProductionStatus,
  ProfileRow,
  QueuedOperation,
  RegisterPayload,
  RequestKind,
  RequestRow,
  ServicePayload,
  ServiceRecordRow,
  ServiceType,
  SettingRow,
  Sex,
  SyncConflict,
  SyncSummary,
  UserRoleRow,
  YesNo,
} from './types';

export type DataPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

interface BovineState {
  userId: string | null;
  phase: DataPhase;
  error: string | null;
  profile: ProfileRow | null;
  myRoles: UserRoleRow[];
  permissions: PermissionMap;
  organisations: OrganisationRow[];
  farms: FarmRow[];
  animalRows: AnimalRow[];
  ownerRows: OwnerRow[];
  serviceRows: ServiceRecordRow[];
  policyRows: PolicyRow[];
  requestRows: RequestRow[];
  notifications: NotificationRow[];
  settings: SettingRow[];
  refreshing: boolean;
  switchingRole: boolean;
  /** Multi-role users pick a workspace once per sign-in. */
  roleConfirmed: boolean;
}

export interface NewAnimalInput {
  /** Stable per registration attempt so retries and sync replays never create a second record. */
  registrationId: string;
  provisionalMoozzleId: string;
  animalType: AnimalType;
  breed: string;
  sex: Sex;
  ageYears: number;
  ageMonths: number;
  ageGroup: AgeGroup;
  productionStatus: ProductionStatus;
  pregnancyStatus: PregnancyStatus;
  dairySociety: YesNo;
  societyName: string;
  societyCode: string;
  memberCode: string;
  gps: GpsFix;
  /** Device clock at the moment the user submitted the registration. */
  registeredAt: Date;
  ownerName: string;
  ownerPhone: string;
  farmId: string | null;
  farmName: string;
  village: string;
  district: string;
  state: string;
  capturedImages: number;
  qualityScore: number;
  embeddings: string[];
  imagePaths: string[];
  qualityScores: number[];
  qualityMetrics: QualityMetrics[];
  saveAsDraft: boolean;
  /** Set only when the operator explicitly submits a possible duplicate for manual review, with a reason. */
  duplicateReviewNote?: string;
}

export interface NewServiceInput {
  animalId: string;
  moozzleId: string;
  serviceType: ServiceType;
  title: string;
  technicianName: string;
  details: Record<string, string>;
  correctsId?: string | null;
}

export interface RegisterResult {
  id: string;
  moozzleId: string;
  approvalStatus: string;
  duplicate: boolean;
  queued: boolean;
  /** True when the server's 1:N search found this animal already registered; no new ID was issued. */
  blocked: boolean;
  /** Possible duplicate held before any ID was issued; the operator must submit it for review or recapture. */
  reviewRequired: boolean;
  match: MatchCandidate | null;
  score: number | null;
  templatesSearched: number | null;
  matchThreshold: number | null;
  reviewThreshold: number | null;
  configVersion: number | null;
}

const initialState: BovineState = {
  userId: null,
  phase: 'idle',
  error: null,
  profile: null,
  myRoles: [],
  permissions: NO_PERMISSIONS,
  organisations: [],
  farms: [],
  animalRows: [],
  ownerRows: [],
  serviceRows: [],
  policyRows: [],
  requestRows: [],
  notifications: [],
  settings: [],
  refreshing: false,
  switchingRole: false,
  roleConfirmed: false,
};

export const useBovineStore = create<BovineState>()(() => initialState);

// Guards so a slow snapshot never overwrites a newer mutation, role or account.
let loadSequence = 0;
let mutationRevision = 0;

export function messageOf(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message) {
    const message = error.message;
    const denied = /^permission_denied:\s*(.+)$/i.exec(message);
    if (denied) return `You do not have permission to ${denied[1]}. Contact your organisation administrator if you believe this is incorrect.`;
    return message;
  }
  return fallback;
}

export function isPermissionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === '42501' || /permission_denied|permission denied/i.test(messageOf(error, ''));
}

export function isNetworkError(error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  return /failed to fetch|network request failed|networkerror|fetch failed|load failed|timed? ?out/i.test(message);
}

/** Provisional 12-digit ID for offline work; the server confirms or replaces it on sync. */
export function generateMoozzleId(): string {
  const bytes = Crypto.getRandomBytes(12);
  const digits = Array.from(bytes, (byte) => String(byte % 10));
  if (digits[0] === '0') digits[0] = String((bytes[0] % 9) + 1);
  return digits.join('');
}

function bump() {
  mutationRevision += 1;
}

function activeRoleOf(state: BovineState): Role | null {
  const role = state.profile?.active_role;
  return role && state.myRoles.some((item) => item.role === role) ? role : null;
}

/** Switches the data store to a signed-in account (or clears it on sign-out). */
export function setActiveUser(userId: string | null) {
  if (useBovineStore.getState().userId === userId) return;
  loadSequence += 1;
  bump();
  useBovineStore.setState({ ...initialState, userId, phase: userId ? 'loading' : 'idle' });
  if (userId) void loadBovineData();
}

async function selectAll<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function loadBovineData(): Promise<void> {
  const { userId, phase } = useBovineStore.getState();
  if (!userId) return;
  const sequence = ++loadSequence;
  const revision = mutationRevision;
  useBovineStore.setState(phase === 'ready' ? { refreshing: true } : { phase: 'loading', error: null });
  try {
    const [profileResult, myRoles] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, active_role, phone, village, privileged_until, privileged_reason, notification_prefs').eq('id', userId).maybeSingle(),
      selectAll<UserRoleRow>(supabase.from('user_roles').select('id, user_id, role, organisation_id, farm_ids, districts, created_at').eq('user_id', userId).order('created_at')),
    ]);
    if (profileResult.error) throw profileResult.error;
    const profile = profileResult.data as ProfileRow | null;
    if (!profile) throw new Error('Your MOOZZLE profile could not be found. Contact your organisation administrator.');
    const role = profile.active_role;

    const [permissionRows, organisations, farms, animalRows, ownerRows, serviceRows, policyRows, requestRows, notifications, settings] = await Promise.all([
      selectAll<{ permission: string; level: string }>(supabase.from('role_permissions').select('permission, level').eq('role', role)),
      selectAll<OrganisationRow>(supabase.from('organisations').select('id, name, org_type, district, state').order('name')),
      selectAll<FarmRow>(supabase.from('farms').select('id, organisation_id, name, village, district, state').order('name')),
      selectAll<AnimalRow>(supabase.from('animals').select('*').order('created_at', { ascending: false })),
      selectAll<OwnerRow>(supabase.from('animal_owners').select('animal_id, owner_name, owner_phone, dairy_society_member, society_name, society_code, member_code, gps_latitude, gps_longitude, gps_accuracy_m, gps_captured_at')),
      selectAll<ServiceRecordRow>(supabase.from('service_records').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })),
      selectAll<PolicyRow>(supabase.from('insurance_policies').select('*').order('created_at', { ascending: false })),
      selectAll<RequestRow>(supabase.from('record_requests').select('*').order('created_at', { ascending: false })),
      selectAll<NotificationRow>(supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)),
      selectAll<SettingRow>(supabase.from('platform_settings').select('key, value, description, risk, updated_at').order('key')),
    ]);
    if (sequence !== loadSequence || revision !== mutationRevision || useBovineStore.getState().userId !== userId) return;

    const permissions = { ...NO_PERMISSIONS };
    for (const row of permissionRows) {
      if ((PERMISSIONS as readonly string[]).includes(row.permission) && isLevel(row.level)) {
        permissions[row.permission as keyof PermissionMap] = row.level;
      }
    }
    useBovineStore.setState({
      phase: 'ready',
      error: null,
      refreshing: false,
      profile,
      myRoles: myRoles.filter((item) => isRole(item.role)),
      // Deny by default: an active role that is not assigned grants nothing.
      permissions: myRoles.some((item) => item.role === role) ? permissions : NO_PERMISSIONS,
      organisations,
      farms,
      animalRows,
      ownerRows,
      serviceRows,
      policyRows,
      requestRows,
      notifications,
      settings,
    });
  } catch (error) {
    console.error('Could not load MOOZZLE records from Supabase', error);
    if (sequence !== loadSequence || useBovineStore.getState().userId !== userId) return;
    if (isNetworkError(error)) void useConnectivity.getState().check();
    const current = useBovineStore.getState();
    useBovineStore.setState({
      refreshing: false,
      phase: current.phase === 'ready' || current.phase === 'offline' ? current.phase : 'error',
      error: messageOf(error, 'Your records could not be loaded.'),
    });
  }
}

/** Lets field work continue with only queued records when the backend is unreachable. */
export function continueOffline() {
  useBovineStore.setState({ phase: 'offline' });
}

function requireSession(): { userId: string; role: Role } {
  const state = useBovineStore.getState();
  const role = activeRoleOf(state);
  if (!state.userId || !role) throw new Error('Please sign in again to continue.');
  return { userId: state.userId, role };
}

async function afterWrite() {
  bump();
  await loadBovineData();
}

/** Calls a checked server operation; denials are recorded in the audit trail. */
async function rpc<T>(fn: string, args: Record<string, unknown>, target = ''): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isPermissionError(error)) void logAudit('access.denied', target, `${fn}: ${messageOf(error, 'denied')}`.slice(0, 200), 'denied');
    throw error;
  }
  return data as T;
}

/** Writes a client-observed event to the audit trail. Never throws; failures are logged. */
export async function logAudit(action: string, target = '', details = '', outcome: 'success' | 'denied' | 'failed' | 'no_match' | 'requested' = 'success', reason = ''): Promise<void> {
  if (!useBovineStore.getState().userId) return;
  try {
    const { error } = await supabase.rpc('log_audit', { p_action: action, p_target: target, p_details: details, p_outcome: outcome, p_reason: reason, p_source: 'moozzle-app' });
    if (error) console.error('Audit event was not recorded', action, error);
  } catch (error) {
    console.error('Audit event was not recorded', action, error);
  }
}

export async function switchRole(role: Role): Promise<void> {
  const state = useBovineStore.getState();
  if (!state.userId) throw new Error('Please sign in again.');
  if (!state.myRoles.some((item) => item.role === role)) throw new Error('This role is not assigned to your account.');
  useBovineStore.setState({ switchingRole: true });
  try {
    await rpc<string>('set_active_role', { p_role: role });
    loadSequence += 1;
    bump();
    // Clear everything the previous role could see before loading the new scope.
    useBovineStore.setState({ ...initialState, userId: state.userId, phase: 'loading', switchingRole: false, roleConfirmed: true });
    await loadBovineData();
  } finally {
    useBovineStore.setState({ switchingRole: false });
  }
}

export function confirmRole() {
  useBovineStore.setState({ roleConfirmed: true });
}

export async function startPrivilegedAccess(reason: string): Promise<void> {
  await rpc('start_privileged_access', { p_reason: reason });
  await afterWrite();
}

export async function endPrivilegedAccess(): Promise<void> {
  await rpc('end_privileged_access', {});
  await afterWrite();
}

function toRegisterPayload(input: NewAnimalInput): RegisterPayload {
  return {
    id: input.registrationId,
    moozzle_id: input.provisionalMoozzleId,
    species: speciesCode(input.animalType),
    breed: input.breed,
    sex: input.sex === 'Female' ? 'female' : 'male',
    age_years: input.ageYears,
    age_months: input.ageMonths,
    age_group: input.ageGroup,
    production_status: input.productionStatus,
    pregnancy_status: input.pregnancyStatus,
    // Dairy details are submitted only for members; values kept in the form for NO are dropped here.
    dairy_society: input.dairySociety,
    society_name: input.dairySociety === 'yes' ? input.societyName.trim() : null,
    society_code: input.dairySociety === 'yes' ? input.societyCode.trim() : null,
    member_code: input.dairySociety === 'yes' ? input.memberCode.trim() : null,
    gps_latitude: input.gps.latitude,
    gps_longitude: input.gps.longitude,
    gps_accuracy_m: input.gps.accuracy,
    gps_captured_at: input.gps.capturedAt,
    gps_mocked: input.gps.mocked,
    device_registered_at: input.registeredAt.toISOString(),
    device_utc_offset_minutes: deviceUtcOffsetMinutes(input.registeredAt),
    owner_name: input.ownerName.trim(),
    owner_phone: input.ownerPhone.trim(),
    farm_id: input.farmId,
    farm_name: input.farmName.trim(),
    village: input.village.trim(),
    district: input.district.trim(),
    state: input.state.trim(),
    captured_images_count: input.capturedImages,
    quality_score: input.qualityScore,
    embeddings: input.embeddings,
    image_paths: input.imagePaths,
    quality_scores: input.qualityScores,
    quality_metrics: input.qualityMetrics,
    save_as_draft: input.saveAsDraft,
    source: 'moozzle-app',
    model: ENGINE_MODEL,
    ...(input.duplicateReviewNote ? { duplicate_review_ack: true, duplicate_review_note: input.duplicateReviewNote.trim() } : {}),
  };
}

interface RegisterResponse {
  id?: string;
  moozzle_id?: string;
  approval_status?: string;
  duplicate: boolean;
  blocked?: boolean;
  review_required?: boolean;
  match?: MatchCandidate;
  review_candidate?: MatchCandidate | null;
  score?: number;
  templates_searched?: number;
  match_threshold?: number;
  review_threshold?: number;
  config_version?: number;
}

export async function createAnimal(input: NewAnimalInput): Promise<RegisterResult> {
  const { userId, role } = requireSession();
  bump();
  const payload = toRegisterPayload(input);
  const queue = (): RegisterResult => {
    // A repeated tap or retry for the same registration must not queue it twice.
    const alreadyQueued = useAppStore.getState().syncQueue.some((op) => op.kind === 'animal' && op.payload.id === payload.id);
    if (!alreadyQueued) {
      useAppStore.getState().enqueue({ kind: 'animal', opId: Crypto.randomUUID(), userId, role, queuedAt: new Date().toISOString(), payload: { ...payload, source: 'offline-queue' } });
    }
    bump();
    return { id: payload.id, moozzleId: payload.moozzle_id, approvalStatus: 'Queued', duplicate: false, queued: true, blocked: false, reviewRequired: false, match: null, score: null, templatesSearched: null, matchThreshold: null, reviewThreshold: null, configVersion: null };
  };
  if (!isOnlineNow()) return queue();
  try {
    const result = await rpc<RegisterResponse>('register_animal', { p: payload });
    await afterWrite();
    const decision = { score: result.score ?? null, templatesSearched: result.templates_searched ?? null, matchThreshold: result.match_threshold ?? null, reviewThreshold: result.review_threshold ?? null, configVersion: result.config_version ?? null };
    if (result.blocked) {
      return { id: '', moozzleId: result.match?.moozzle_id ?? '', approvalStatus: 'Blocked', duplicate: true, queued: false, blocked: true, reviewRequired: false, match: result.match ?? null, ...decision };
    }
    if (result.review_required) {
      return { id: '', moozzleId: '', approvalStatus: 'Review Required', duplicate: true, queued: false, blocked: false, reviewRequired: true, match: result.match ?? null, ...decision };
    }
    return {
      id: result.id ?? payload.id,
      moozzleId: result.moozzle_id ?? payload.moozzle_id,
      approvalStatus: result.approval_status ?? 'Submitted',
      duplicate: result.duplicate,
      queued: false,
      blocked: false,
      reviewRequired: false,
      match: result.review_candidate ?? null,
      ...decision,
    };
  } catch (error) {
    if (isNetworkError(error)) {
      void useConnectivity.getState().check();
      return queue();
    }
    await afterWrite();
    throw error;
  }
}

export async function addServiceRecord(input: NewServiceInput): Promise<{ queued: boolean }> {
  const { userId, role } = requireSession();
  bump();
  const payload: ServicePayload = {
    id: Crypto.randomUUID(),
    animal_id: input.animalId,
    service_type: input.serviceType,
    title: input.title,
    date: new Date().toISOString().slice(0, 10),
    technician_name: input.technicianName.trim(),
    details: input.details,
    corrects_id: input.correctsId ?? null,
    source: 'moozzle-app',
  };
  const animalIsQueued = useAppStore.getState().syncQueue.some((op) => op.kind === 'animal' && op.payload.id === input.animalId);
  const queue = () => {
    useAppStore.getState().enqueue({ kind: 'service', opId: Crypto.randomUUID(), userId, role, queuedAt: new Date().toISOString(), moozzleId: input.moozzleId, payload: { ...payload, source: 'offline-queue' } });
    bump();
    return { queued: true };
  };
  if (!isOnlineNow() || animalIsQueued) return queue();
  try {
    await rpc<string>('add_service_record', { p: payload }, input.moozzleId);
    await afterWrite();
    return { queued: false };
  } catch (error) {
    if (isNetworkError(error)) {
      void useConnectivity.getState().check();
      return queue();
    }
    await afterWrite();
    throw error;
  }
}

/** Sensitive actions stay online-only so they are authorised against current server state. */
function requireOnline() {
  if (!isOnlineNow()) throw new Error('This action needs a connection so it can be authorised. Reconnect and try again.');
}

export async function retireAnimal(animalId: string, moozzleId: string, reason: string): Promise<'retired' | 'requested'> {
  requireSession();
  requireOnline();
  bump();
  try {
    return await rpc<'retired' | 'requested'>('retire_animal', { p_id: animalId, p_reason: reason }, moozzleId);
  } finally {
    await afterWrite();
  }
}

function checkAgeField(value: string | undefined, max: number, label: string) {
  const text = value?.trim() ?? '';
  if (text === '') return;
  if (!/^\d+$/.test(text) || Number(text) > max) throw new Error(`${label} must be a whole number from 0 to ${max}.`);
}

export async function createRequest(kind: Exclude<RequestKind, 'retire'>, animalId: string, moozzleId: string, payload: Record<string, string>): Promise<void> {
  requireSession();
  requireOnline();
  if (kind === 'correction') {
    checkAgeField(payload.age_years, AGE_MAX_YEARS, 'Correct age – years');
    checkAgeField(payload.age_months, AGE_MAX_MONTHS, 'Correct age – months');
  }
  bump();
  try {
    await rpc('create_request', { p_kind: kind, p_animal: animalId, p_payload: payload }, moozzleId);
  } finally {
    await afterWrite();
  }
}

export async function reviewRequest(requestId: string, decision: string, note: string, moozzleId: string): Promise<void> {
  requireSession();
  requireOnline();
  bump();
  try {
    await rpc('review_request', { p_id: requestId, p_decision: decision, p_note: note }, moozzleId);
  } finally {
    await afterWrite();
  }
}

export async function reviewAnimal(animalId: string, decision: 'Approved' | 'Rejected', note: string, moozzleId: string): Promise<void> {
  requireSession();
  requireOnline();
  bump();
  try {
    await rpc('review_animal', { p_id: animalId, p_decision: decision, p_note: note }, moozzleId);
  } finally {
    await afterWrite();
  }
}

export async function submitDraft(animalId: string, moozzleId: string): Promise<void> {
  requireSession();
  requireOnline();
  bump();
  try {
    await rpc('submit_animal', { p_id: animalId }, moozzleId);
  } finally {
    await afterWrite();
  }
}

export async function recordVerification(policyId: string, outcome: 'Verified' | 'Mismatch' | 'Manual Review' | 'Exception', notes: string, score: number | null, moozzleId: string): Promise<void> {
  requireSession();
  requireOnline();
  bump();
  try {
    await rpc('record_verification', { p_policy: policyId, p_outcome: outcome, p_notes: notes, p_score: score }, moozzleId);
  } finally {
    await afterWrite();
  }
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const previous = useBovineStore.getState().notifications;
  useBovineStore.setState({ notifications: previous.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item)) });
  const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids);
  if (error) {
    useBovineStore.setState({ notifications: previous });
    throw error;
  }
}

export async function saveNotificationPrefs(prefs: Record<string, boolean>): Promise<void> {
  const { userId } = requireSession();
  const { error } = await supabase.from('profiles').update({ notification_prefs: prefs }).eq('id', userId);
  if (error) throw error;
  await afterWrite();
}

export async function updateOwnProfile(fields: { full_name: string; phone: string; village: string }): Promise<void> {
  const { userId } = requireSession();
  const { data, error } = await supabase.from('profiles').update(fields).eq('id', userId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Your profile could not be updated.');
  await afterWrite();
}

// ---------- Offline sync ----------

let syncInFlight: Promise<SyncSummary> | null = null;

/** Uploads this account's queued writes through the same checked RPCs. Permissions are re-evaluated server-side. */
export function syncQueuedOperations(): Promise<SyncSummary> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSync(): Promise<SyncSummary> {
  const { userId } = requireSession();
  bump();
  const pending = useAppStore.getState().syncQueue.filter((op) => op.userId === userId);
  let recordsUploaded = 0;
  let imagesUploaded = 0;
  let errors = 0;
  let revoked = 0;
  const conflicts: SyncConflict[] = [];
  const replacedIds = new Map<string, string>();
  let networkFailure: unknown = null;

  for (const op of pending) {
    try {
      if (op.kind === 'animal') {
        const result = await rpc<RegisterResponse>('register_animal', { p: op.payload }, op.payload.moozzle_id);
        if (result.review_required) {
          // Never resolved silently during sync: the operator must compare the muzzles and decide.
          errors += 1;
          useAppStore.getState().addFailed({ operation: op, error: `POSSIBLE DUPLICATE — REVIEW REQUIRED (similarity ${result.score?.toFixed(3) ?? '—'} to an enrolled animal). No MOOZZLE ID was issued. Register the animal again while online to compare the muzzles and, if appropriate, submit it for duplicate review.`, failedAt: new Date().toISOString(), revoked: false });
          useAppStore.getState().removeQueued(op.opId);
          continue;
        }
        if (result.blocked || !result.moozzle_id) {
          errors += 1;
          useAppStore.getState().addFailed({ operation: op, error: `ANIMAL ALREADY REGISTERED as ${result.match?.moozzle_id ?? 'an existing ID'} (similarity ${result.score?.toFixed(3) ?? '—'}). No duplicate ID was issued.`, failedAt: new Date().toISOString(), revoked: false });
          useAppStore.getState().removeQueued(op.opId);
          continue;
        }
        if (result.moozzle_id !== op.payload.moozzle_id) {
          replacedIds.set(op.payload.moozzle_id, result.moozzle_id);
          conflicts.push({ provisionalId: op.payload.moozzle_id, assignedId: result.moozzle_id, note: 'Provisional ID was already in use; the server issued a new permanent ID.' });
        }
        if (result.duplicate) conflicts.push({ provisionalId: op.payload.moozzle_id, assignedId: result.moozzle_id, note: 'Possible duplicate identity — sent for manual review instead of being merged.' });
        recordsUploaded += 1;
        imagesUploaded += op.payload.image_paths?.length ?? 0;
      } else {
        await rpc<string>('add_service_record', { p: op.payload }, replacedIds.get(op.moozzleId) ?? op.moozzleId);
        recordsUploaded += 1;
      }
      useAppStore.getState().removeQueued(op.opId);
    } catch (error) {
      console.error('Could not sync queued operation', op.kind, error);
      if (isNetworkError(error)) {
        networkFailure = error;
        errors += 1;
        break;
      }
      const permission = isPermissionError(error);
      if (permission) revoked += 1;
      errors += 1;
      useAppStore.getState().addFailed({ operation: op, error: messageOf(error, 'Upload was rejected.'), failedAt: new Date().toISOString(), revoked: permission });
    }
  }

  const summary: SyncSummary = { recordsUploaded, imagesUploaded, errors, revoked, conflicts, completedAt: new Date().toISOString() };
  useAppStore.getState().setLastSyncSummary(summary);
  if (!networkFailure) {
    void logAudit('sync.run', '', `${recordsUploaded} uploaded, ${errors} failed, ${revoked} revoked, ${conflicts.length} conflicts`, errors > 0 ? 'failed' : 'success');
  }
  await afterWrite();
  if (networkFailure && recordsUploaded === 0) throw networkFailure;
  return summary;
}

// ---------- Mapping ----------

function toAnimal(row: AnimalRow, owner: OwnerRow | undefined, pending = false): Animal {
  const retired = row.status === 'retired';
  return {
    id: row.id,
    moozzle_id: row.moozzle_id,
    animal_type: animalTypeFromCode(row.species),
    breed: row.breed,
    sex: row.sex === 'male' ? 'Male' : 'Female',
    age_years: row.age_years,
    age_months: row.age_months ?? 0,
    age_group: row.age_group ?? null,
    production_status: row.production_status ?? null,
    pregnancy_status: row.pregnancy_status ?? null,
    device_registered_at: row.device_registered_at ?? null,
    device_utc_offset_minutes: row.device_utc_offset_minutes ?? null,
    dairy_society_member: owner?.dairy_society_member ?? null,
    society_name: owner?.society_name ?? '',
    society_code: owner?.society_code ?? '',
    member_code: owner?.member_code ?? '',
    gps:
      typeof owner?.gps_latitude === 'number' && typeof owner?.gps_longitude === 'number'
        ? { latitude: owner.gps_latitude, longitude: owner.gps_longitude, accuracy: owner.gps_accuracy_m ?? null, capturedAt: owner.gps_captured_at ?? null }
        : null,
    owner_name: owner?.owner_name ?? '',
    owner_phone: owner?.owner_phone ?? '',
    owner_visible: !!owner,
    owner_user_id: row.owner_user_id,
    farm_id: row.farm_id,
    farm_name: row.farm_name,
    organisation_id: row.organisation_id,
    village: row.village,
    district: row.district,
    state: row.state,
    registration_date: row.created_at,
    biometric_status: retired ? 'Retired' : row.biometric_status === 'pending_quality' ? 'Pending Quality' : 'Enrolled',
    current_status: retired ? 'Retired' : 'Active',
    approval_status: row.approval_status,
    duplicate_of: row.duplicate_of,
    review_note: row.review_note,
    retire_reason: row.retire_reason ?? undefined,
    retire_date: row.retired_at ?? undefined,
    captured_images_count: row.captured_images_count,
    reference_image_path: row.reference_image_path ?? null,
    created_by: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pending_sync: pending,
  };
}

function queuedAnimal(op: Extract<QueuedOperation, { kind: 'animal' }>): Animal {
  const p = op.payload;
  return toAnimal(
    {
      id: p.id,
      user_id: op.userId,
      moozzle_id: p.moozzle_id,
      species: p.species,
      breed: p.breed,
      sex: p.sex,
      age_years: p.age_years,
      age_months: p.age_months ?? 0,
      age_group: p.age_group ?? null,
      production_status: p.production_status ?? null,
      pregnancy_status: p.pregnancy_status ?? null,
      device_registered_at: p.device_registered_at ?? null,
      device_utc_offset_minutes: p.device_utc_offset_minutes ?? null,
      farm_name: p.farm_name,
      village: p.village,
      district: p.district,
      state: p.state,
      biometric_status: 'enrolled',
      status: 'active',
      retire_reason: null,
      retired_at: null,
      captured_images_count: p.captured_images_count,
      organisation_id: null,
      farm_id: p.farm_id,
      owner_user_id: null,
      approval_status: p.save_as_draft ? 'Draft' : 'Submitted',
      duplicate_of: null,
      review_note: null,
      created_at: op.queuedAt,
      updated_at: op.queuedAt,
    },
    {
      animal_id: p.id,
      owner_name: p.owner_name,
      owner_phone: p.owner_phone,
      dairy_society_member: p.dairy_society ? p.dairy_society === 'yes' : null,
      society_name: p.society_name ?? null,
      society_code: p.society_code ?? null,
      member_code: p.member_code ?? null,
      gps_latitude: p.gps_latitude ?? null,
      gps_longitude: p.gps_longitude ?? null,
      gps_accuracy_m: p.gps_accuracy_m ?? null,
      gps_captured_at: p.gps_captured_at ?? null,
    },
    true
  );
}

function toServiceRecord(row: ServiceRecordRow, correctedBy: string | null, pending = false): LivestockServiceRecord {
  const { notes, ...metadata } = row.details ?? {};
  return {
    id: row.id,
    animal_id: row.animal_id,
    service_type: row.service_type,
    record_type: row.title,
    date: row.date,
    performed_by: row.technician_name,
    performer_role: row.performer_role,
    author_id: row.user_id,
    details: notes ?? row.title,
    metadata,
    corrects_id: row.corrects_id,
    corrected_by: correctedBy,
    created_at: row.created_at,
    pending_sync: pending,
  };
}

export interface BovineData {
  animals: Animal[];
  records: LivestockServiceRecord[];
  phase: DataPhase;
  error: string | null;
  refreshing: boolean;
  pendingCount: number;
}

/** Supabase rows (already filtered by RLS for the active role) merged with this account's queued offline writes. */
export function useBovineData(): BovineData {
  const userId = useBovineStore((state) => state.userId);
  const animalRows = useBovineStore((state) => state.animalRows);
  const ownerRows = useBovineStore((state) => state.ownerRows);
  const serviceRows = useBovineStore((state) => state.serviceRows);
  const phase = useBovineStore((state) => state.phase);
  const error = useBovineStore((state) => state.error);
  const refreshing = useBovineStore((state) => state.refreshing);
  const syncQueue = useAppStore((state) => state.syncQueue);

  return useMemo(() => {
    const queue = syncQueue.filter((op) => op.userId === userId);
    const owners = new Map(ownerRows.map((row) => [row.animal_id, row]));
    const remoteIds = new Set(animalRows.map((row) => row.id));
    const queued = queue.flatMap((op) => (op.kind === 'animal' && !remoteIds.has(op.payload.id) ? [queuedAnimal(op)] : []));
    const animals = [...queued, ...animalRows.map((row) => toAnimal(row, owners.get(row.id)))];

    const correctedBy = new Map<string, string>();
    for (const row of serviceRows) if (row.corrects_id) correctedBy.set(row.corrects_id, row.id);
    const remoteServiceIds = new Set(serviceRows.map((row) => row.id));
    const queuedRecords = queue.flatMap((op) =>
      op.kind === 'service' && !remoteServiceIds.has(op.payload.id)
        ? [toServiceRecord({ ...op.payload, user_id: op.userId, performer_role: op.role, signed_at: op.queuedAt, created_at: op.queuedAt }, null, true)]
        : []
    );
    const records = [...queuedRecords, ...serviceRows.map((row) => toServiceRecord(row, correctedBy.get(row.id) ?? null))];
    return { animals, records, phase, error, refreshing, pendingCount: queue.length };
  }, [animalRows, error, ownerRows, phase, refreshing, serviceRows, syncQueue, userId]);
}

export interface SessionInfo {
  userId: string | null;
  role: Role | null;
  roles: Role[];
  permissions: PermissionMap;
  privileged: boolean;
  privilegedUntil: string | null;
  scope: UserRoleRow | null;
  organisation: OrganisationRow | null;
  scopeLabel: string;
  name: string;
  experience: (typeof ROLE_EXPERIENCE)[Role] | null;
}

/** The active role, its permissions (from the backend matrix) and data scope. */
export function useSession(): SessionInfo {
  const userId = useBovineStore((state) => state.userId);
  const profile = useBovineStore((state) => state.profile);
  const myRoles = useBovineStore((state) => state.myRoles);
  const permissions = useBovineStore((state) => state.permissions);
  const organisations = useBovineStore((state) => state.organisations);
  const farms = useBovineStore((state) => state.farms);
  return useMemo(() => {
    const role = profile?.active_role && myRoles.some((item) => item.role === profile.active_role) ? profile.active_role : null;
    const scope = myRoles.find((item) => item.role === role) ?? null;
    const organisation = organisations.find((item) => item.id === scope?.organisation_id) ?? null;
    const farmNames = farms.filter((farm) => scope?.farm_ids.includes(farm.id)).map((farm) => farm.name);
    let scopeLabel = organisation?.name ?? 'Personal account';
    if (role === 'Farmer') scopeLabel = profile?.village ? `My farm · ${profile.village}` : 'My animals';
    else if (farmNames.length) scopeLabel = farmNames.length === 1 ? farmNames[0] : `${farmNames[0]} +${farmNames.length - 1}`;
    else if (scope?.districts.length) scopeLabel = `${scope.districts.join(', ')} district${scope.districts.length > 1 ? 's' : ''}`;
    const privilegedUntil = role === 'Super Administrator' ? profile?.privileged_until ?? null : null;
    return {
      userId,
      role,
      roles: myRoles.map((item) => item.role),
      permissions: role ? permissions : NO_PERMISSIONS,
      privileged: !!privilegedUntil && new Date(privilegedUntil).getTime() > Date.now(),
      privilegedUntil,
      scope,
      organisation,
      scopeLabel,
      name: profile?.full_name?.trim() || profile?.email || 'MOOZZLE user',
      experience: role ? ROLE_EXPERIENCE[role] : null,
    };
  }, [farms, myRoles, organisations, permissions, profile, userId]);
}
