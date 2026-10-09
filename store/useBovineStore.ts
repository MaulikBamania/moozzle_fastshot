import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAppStore } from './useAppStore';
import { isOnlineNow, useConnectivity } from './useConnectivity';
import type {
  Animal,
  AnimalRow,
  AnimalType,
  BiometricTemplate,
  BiometricTemplateRow,
  LivestockServiceRecord,
  ProfileRow,
  QueuedOperation,
  ServiceRecordRow,
  ServiceType,
  Sex,
  SyncSummary,
} from './types';

export type DataPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

export const MODEL_VERSION = 'moozzle-proto-v1.0';

interface BovineState {
  userId: string | null;
  phase: DataPhase;
  error: string | null;
  profile: ProfileRow | null;
  animalRows: AnimalRow[];
  templateRows: BiometricTemplateRow[];
  serviceRows: ServiceRecordRow[];
  refreshing: boolean;
}

export interface NewAnimalInput {
  animalType: AnimalType;
  breed: string;
  sex: Sex;
  ageYears: number;
  ownerName: string;
  ownerPhone: string;
  farmName: string;
  village: string;
  district: string;
  state: string;
  capturedImages: number;
  qualityScore: number;
}

export interface NewServiceInput {
  animalId: string;
  serviceType: ServiceType;
  title: string;
  technicianName: string;
  details: Record<string, string>;
}

export interface WriteResult {
  queued: boolean;
}

const initialState: BovineState = {
  userId: null,
  phase: 'idle',
  error: null,
  profile: null,
  animalRows: [],
  templateRows: [],
  serviceRows: [],
  refreshing: false,
};

export const useBovineStore = create<BovineState>()(() => initialState);

// Guards so a slow snapshot can never overwrite a newer mutation or another account's data.
let loadSequence = 0;
let mutationRevision = 0;

export function messageOf(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fallback;
}

export function isNetworkError(error: unknown): boolean {
  const message = messageOf(error, '');
  return /failed to fetch|network request failed|networkerror|fetch failed|load failed|timed? ?out/i.test(message);
}

function isMoozzleConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === '23505' && /moozzle/i.test(messageOf(error, ''));
}

/** 12 random digits, first digit non-zero. Uniqueness is enforced by the database. */
export function generateMoozzleId(): string {
  const bytes = Crypto.getRandomBytes(12);
  const digits = Array.from(bytes, (byte) => String(byte % 10));
  if (digits[0] === '0') digits[0] = String((bytes[0] % 9) + 1);
  return digits.join('');
}

function embeddingPreview(): string {
  const bytes = Crypto.getRandomBytes(8);
  return Array.from(bytes, (byte) => (byte / 255).toFixed(3)).join(',');
}

function bump() {
  mutationRevision += 1;
}

function upsertById<T extends { id: string }>(rows: T[], row: T): T[] {
  const exists = rows.some((item) => item.id === row.id);
  return exists ? rows.map((item) => (item.id === row.id ? row : item)) : [row, ...rows];
}

/** Switches the data store to a signed-in account (or clears it on sign-out). */
export function setActiveUser(userId: string | null) {
  if (useBovineStore.getState().userId === userId) return;
  loadSequence += 1;
  bump();
  useBovineStore.setState({ ...initialState, userId, phase: userId ? 'loading' : 'idle' });
  if (userId) void loadBovineData();
}

export async function loadBovineData(): Promise<void> {
  const { userId, phase } = useBovineStore.getState();
  if (!userId) return;
  const sequence = ++loadSequence;
  const revision = mutationRevision;
  useBovineStore.setState(phase === 'ready' ? { refreshing: true } : { phase: 'loading', error: null });
  try {
    const [animals, templates, services, profile] = await Promise.all([
      supabase.from('animals').select('*').order('created_at', { ascending: false }),
      supabase.from('biometric_templates').select('*'),
      supabase.from('service_records').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role, phone, village').eq('id', userId).maybeSingle(),
    ]);
    const failure = animals.error ?? templates.error ?? services.error ?? profile.error;
    if (failure) throw failure;
    if (sequence !== loadSequence || revision !== mutationRevision || useBovineStore.getState().userId !== userId) return;
    useBovineStore.setState({
      phase: 'ready',
      error: null,
      refreshing: false,
      animalRows: (animals.data ?? []) as AnimalRow[],
      templateRows: (templates.data ?? []) as BiometricTemplateRow[],
      serviceRows: (services.data ?? []) as ServiceRecordRow[],
      profile: (profile.data as ProfileRow | null) ?? null,
    });
  } catch (error) {
    console.error('Could not load bovine records from Supabase', error);
    if (sequence !== loadSequence || useBovineStore.getState().userId !== userId) return;
    if (isNetworkError(error)) void useConnectivity.getState().check();
    const current = useBovineStore.getState();
    useBovineStore.setState({
      refreshing: false,
      // Keep showing an already loaded snapshot; surface the error.
      phase: current.phase === 'ready' || current.phase === 'offline' ? current.phase : 'error',
      error: messageOf(error, 'Your bovine records could not be loaded.'),
    });
  }
}

/** Lets field work continue with only queued records when the backend is unreachable. */
export function continueOffline() {
  useBovineStore.setState({ phase: 'offline' });
}

function requireUser(): string {
  const { userId } = useBovineStore.getState();
  if (!userId) throw new Error('Please sign in again to save records.');
  return userId;
}

async function afterWrite() {
  bump();
  await loadBovineData();
}

export async function createAnimal(input: NewAnimalInput): Promise<{ animal: Animal; queued: boolean }> {
  const userId = requireUser();
  bump();
  const now = new Date().toISOString();
  const animalId = Crypto.randomUUID();
  const templateId = Crypto.randomUUID();
  const baseAnimal = {
    id: animalId,
    user_id: userId,
    species: input.animalType === 'Cattle' ? ('cattle' as const) : ('buffalo' as const),
    breed: input.breed,
    sex: input.sex === 'Female' ? ('female' as const) : ('male' as const),
    age_years: input.ageYears,
    owner_name: input.ownerName.trim(),
    owner_phone: input.ownerPhone.trim(),
    farm_name: input.farmName.trim(),
    village: input.village.trim(),
    district: input.district.trim(),
    state: input.state.trim(),
    biometric_status: 'enrolled' as const,
    status: 'active' as const,
    retire_reason: null,
    retired_at: null,
    captured_images_count: input.capturedImages,
  };
  const templateBase = {
    id: templateId,
    user_id: userId,
    animal_id: animalId,
    quality_score: input.qualityScore,
    embedding_preview: embeddingPreview(),
    model_version: MODEL_VERSION,
  };

  const queue = (moozzleId: string) => {
    const operation: QueuedOperation = {
      kind: 'animal',
      opId: Crypto.randomUUID(),
      userId,
      queuedAt: now,
      animal: { ...baseAnimal, moozzle_id: moozzleId, created_at: now },
      template: { ...templateBase, moozzle_id: moozzleId, created_at: now },
    };
    useAppStore.getState().enqueue(operation);
    bump();
    return { animal: toAnimal({ ...operation.animal, updated_at: now }, toTemplate({ ...operation.template }), true), queued: true };
  };

  if (!isOnlineNow()) return queue(generateMoozzleId());

  let moozzleId = generateMoozzleId();
  let inserted: AnimalRow | null = null;
  for (let attempt = 0; attempt < 4 && !inserted; attempt += 1) {
    const { data, error } = await supabase.from('animals').insert({ ...baseAnimal, moozzle_id: moozzleId }).select('*').single();
    if (!error) {
      inserted = data as AnimalRow;
      break;
    }
    if (isMoozzleConflict(error)) {
      moozzleId = generateMoozzleId();
      continue;
    }
    if (isNetworkError(error)) {
      void useConnectivity.getState().check();
      return queue(moozzleId);
    }
    throw error;
  }
  if (!inserted) throw new Error('A unique MOOZZLE ID could not be assigned. Please retry.');

  const { data: template, error: templateError } = await supabase
    .from('biometric_templates')
    .insert({ ...templateBase, moozzle_id: moozzleId })
    .select('*')
    .single();
  if (templateError) {
    console.error('Biometric template insert failed; rolling back animal', templateError);
    const { error: rollbackError } = await supabase.from('animals').delete().eq('id', animalId);
    if (rollbackError) console.error('Rollback of animal failed', rollbackError);
    await afterWrite();
    throw templateError;
  }
  const templateRow = template as BiometricTemplateRow;
  useBovineStore.setState((state) => ({
    animalRows: upsertById(state.animalRows, inserted),
    templateRows: upsertById(state.templateRows, templateRow),
  }));
  await afterWrite();
  return { animal: toAnimal(inserted, toTemplate(templateRow)), queued: false };
}

export async function addServiceRecord(input: NewServiceInput): Promise<WriteResult> {
  const userId = requireUser();
  bump();
  const now = new Date().toISOString();
  const record = {
    id: Crypto.randomUUID(),
    user_id: userId,
    animal_id: input.animalId,
    service_type: input.serviceType,
    title: input.title,
    date: now.slice(0, 10),
    technician_name: input.technicianName.trim(),
    details: input.details,
  };
  const animalIsQueued = useAppStore.getState().syncQueue.some((op) => op.kind === 'animal' && op.animal.id === input.animalId);
  const queue = () => {
    useAppStore.getState().enqueue({ kind: 'service', opId: Crypto.randomUUID(), userId, queuedAt: now, record: { ...record, created_at: now } });
    bump();
    return { queued: true };
  };
  if (!isOnlineNow() || animalIsQueued) return queue();

  const { data, error } = await supabase.from('service_records').insert(record).select('*').single();
  if (error) {
    if (isNetworkError(error)) {
      void useConnectivity.getState().check();
      return queue();
    }
    await afterWrite();
    throw error;
  }
  useBovineStore.setState((state) => ({ serviceRows: upsertById(state.serviceRows, data as ServiceRecordRow) }));
  await afterWrite();
  return { queued: false };
}

export async function retireAnimal(animalId: string, reason: string): Promise<WriteResult> {
  const userId = requireUser();
  bump();
  const retiredAt = new Date().toISOString();
  const animalIsQueued = useAppStore.getState().syncQueue.some((op) => op.kind === 'animal' && op.animal.id === animalId);
  const queue = () => {
    useAppStore.getState().enqueue({ kind: 'retire', opId: Crypto.randomUUID(), userId, queuedAt: retiredAt, animalId, reason, retiredAt });
    bump();
    return { queued: true };
  };
  if (!isOnlineNow() || animalIsQueued) return queue();

  const { data, error } = await supabase
    .from('animals')
    .update({ status: 'retired', biometric_status: 'retired', retire_reason: reason, retired_at: retiredAt })
    .eq('id', animalId)
    .select('*');
  if (error) {
    if (isNetworkError(error)) {
      void useConnectivity.getState().check();
      return queue();
    }
    await afterWrite();
    throw error;
  }
  const updated = (data ?? [])[0] as AnimalRow | undefined;
  if (!updated) {
    await afterWrite();
    throw new Error('This animal could not be updated. It may belong to another account.');
  }
  useBovineStore.setState((state) => ({ animalRows: upsertById(state.animalRows, updated) }));
  await afterWrite();
  return { queued: false };
}

let syncInFlight: Promise<SyncSummary> | null = null;

/** Uploads this account's queued writes to Supabase, in order. */
export function syncQueuedOperations(): Promise<SyncSummary> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSync(): Promise<SyncSummary> {
  const userId = requireUser();
  bump();
  const app = useAppStore.getState();
  const pending = app.syncQueue.filter((op) => op.userId === userId);
  let recordsUploaded = 0;
  let templatesUploaded = 0;
  let errors = 0;
  let firstError: unknown = null;

  for (const original of pending) {
    let op = original;
    try {
      if (op.kind === 'animal') {
        let done = false;
        for (let attempt = 0; attempt < 4 && !done; attempt += 1) {
          const { error } = await supabase.from('animals').upsert(op.animal, { onConflict: 'id', ignoreDuplicates: true });
          if (!error) {
            done = true;
            break;
          }
          if (isMoozzleConflict(error)) {
            const moozzleId = generateMoozzleId();
            op = { ...op, animal: { ...op.animal, moozzle_id: moozzleId }, template: { ...op.template, moozzle_id: moozzleId } };
            useAppStore.getState().updateQueued(op.opId, op);
            continue;
          }
          throw error;
        }
        if (!done) throw new Error('A unique MOOZZLE ID could not be assigned during sync.');
        const { error: templateError } = await supabase.from('biometric_templates').upsert(op.template, { onConflict: 'id', ignoreDuplicates: true });
        if (templateError) throw templateError;
        recordsUploaded += 1;
        templatesUploaded += 1;
      } else if (op.kind === 'service') {
        const { error } = await supabase.from('service_records').upsert(op.record, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw error;
        recordsUploaded += 1;
      } else {
        const { error } = await supabase
          .from('animals')
          .update({ status: 'retired', biometric_status: 'retired', retire_reason: op.reason, retired_at: op.retiredAt })
          .eq('id', op.animalId);
        if (error) throw error;
        recordsUploaded += 1;
      }
      useAppStore.getState().removeQueued(op.opId);
    } catch (error) {
      console.error('Could not sync queued operation', op.kind, error);
      errors += 1;
      firstError ??= error;
      // Without a connection the rest would fail the same way.
      if (isNetworkError(error)) break;
    }
  }

  const summary: SyncSummary = { recordsUploaded, imagesUploaded: templatesUploaded, errors, completedAt: new Date().toISOString() };
  useAppStore.getState().setLastSyncSummary(summary);
  await afterWrite();
  if (firstError && recordsUploaded === 0) throw firstError;
  return summary;
}

// ---------- Mapping ----------

function toTemplate(row: Omit<BiometricTemplateRow, 'user_id'> & { user_id?: string }): BiometricTemplate {
  return {
    template_id: row.id,
    animal_id: row.animal_id,
    moozzle_id: row.moozzle_id,
    quality_score: Number(row.quality_score),
    model_version: row.model_version,
    embedding_preview: row.embedding_preview,
    created_at: row.created_at,
  };
}

function toAnimal(row: AnimalRow, template: BiometricTemplate | undefined, pending = false): Animal {
  const retired = row.status === 'retired';
  return {
    id: row.id,
    moozzle_id: row.moozzle_id,
    animal_type: row.species === 'buffalo' ? 'Buffalo' : 'Cattle',
    breed: row.breed,
    sex: row.sex === 'male' ? 'Male' : 'Female',
    age_years: row.age_years,
    owner_name: row.owner_name,
    owner_phone: row.owner_phone,
    farm_name: row.farm_name,
    village: row.village,
    district: row.district,
    state: row.state,
    registration_date: row.created_at,
    biometric_status: retired ? 'Retired' : row.biometric_status === 'pending_quality' ? 'Pending Quality' : 'Enrolled',
    current_status: retired ? 'Retired' : 'Active',
    retire_reason: row.retire_reason ?? undefined,
    retire_date: row.retired_at ?? undefined,
    captured_images_count: row.captured_images_count,
    biometric_template_id: template?.template_id ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    pending_sync: pending,
  };
}

const SERVICE_DETAIL_NOTES_KEY = 'notes';

function toServiceRecord(row: Omit<ServiceRecordRow, 'user_id'> & { user_id?: string }, pending = false): LivestockServiceRecord {
  const { [SERVICE_DETAIL_NOTES_KEY]: notes, ...metadata } = row.details ?? {};
  return {
    id: row.id,
    animal_id: row.animal_id,
    service_type: row.service_type,
    record_type: row.title,
    date: row.date,
    performed_by: row.technician_name,
    details: notes ?? row.title,
    metadata,
    pending_sync: pending,
  };
}

export interface BovineData {
  animals: Animal[];
  templates: BiometricTemplate[];
  records: LivestockServiceRecord[];
  phase: DataPhase;
  error: string | null;
  refreshing: boolean;
  pendingCount: number;
}

/** Supabase rows merged with this account's still-queued offline writes. */
export function useBovineData(): BovineData {
  const userId = useBovineStore((state) => state.userId);
  const animalRows = useBovineStore((state) => state.animalRows);
  const templateRows = useBovineStore((state) => state.templateRows);
  const serviceRows = useBovineStore((state) => state.serviceRows);
  const phase = useBovineStore((state) => state.phase);
  const error = useBovineStore((state) => state.error);
  const refreshing = useBovineStore((state) => state.refreshing);
  const syncQueue = useAppStore((state) => state.syncQueue);

  return useMemo(() => {
    const queue = syncQueue.filter((op) => op.userId === userId);
    const templates = templateRows.map(toTemplate);
    const remoteAnimalIds = new Set(animalRows.map((row) => row.id));
    const remoteServiceIds = new Set(serviceRows.map((row) => row.id));
    for (const op of queue) {
      if (op.kind === 'animal' && !remoteAnimalIds.has(op.animal.id)) templates.push(toTemplate(op.template));
    }
    const templateByAnimal = new Map(templates.map((template) => [template.animal_id, template]));

    let animals = animalRows.map((row) => toAnimal(row, templateByAnimal.get(row.id)));
    const queuedAnimals = queue.flatMap((op) =>
      op.kind === 'animal' && !remoteAnimalIds.has(op.animal.id)
        ? [toAnimal({ ...op.animal, updated_at: op.animal.created_at }, templateByAnimal.get(op.animal.id), true)]
        : []
    );
    const retirements = new Map(queue.flatMap((op) => (op.kind === 'retire' ? [[op.animalId, op] as const] : [])));
    animals = [...queuedAnimals, ...animals].map((animal) => {
      const retire = retirements.get(animal.id);
      return retire
        ? { ...animal, current_status: 'Retired', biometric_status: 'Retired', retire_reason: retire.reason, retire_date: retire.retiredAt, pending_sync: true }
        : animal;
    });
    animals.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const queuedRecords = queue.flatMap((op) => (op.kind === 'service' && !remoteServiceIds.has(op.record.id) ? [toServiceRecord(op.record, true)] : []));
    const records = [...queuedRecords, ...serviceRows.map((row) => toServiceRecord(row))];

    return { animals, templates, records, phase, error, refreshing, pendingCount: queue.length };
  }, [animalRows, error, phase, refreshing, serviceRows, syncQueue, templateRows, userId]);
}
