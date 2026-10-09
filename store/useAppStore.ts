import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage, trackLoading, useStorageStatus } from './storage';
import type { FailedOperation, Language, Preferences, QueuedOperation, SyncSummary, ValidationTrial } from './types';

interface AppActions {
  setLanguage: (language: Language) => void;
  setOfflineMode: (enabled: boolean) => void;
  enqueue: (operation: QueuedOperation) => void;
  updateQueued: (opId: string, operation: QueuedOperation) => void;
  removeQueued: (opId: string) => void;
  addFailed: (failed: FailedOperation) => void;
  discardFailed: (opId: string) => void;
  requeueFailed: (opId: string) => void;
  setLastSyncSummary: (summary: SyncSummary) => void;
  addValidationTrial: (trial: ValidationTrial) => void;
}

/**
 * Device-only state: preferences, the offline write queue and field-trial logs.
 * Bovine records themselves live in Supabase (see store/useBovineStore.ts).
 */
export interface AppStore extends AppActions {
  preferences: Preferences;
  validationTrials: ValidationTrial[];
  syncQueue: QueuedOperation[];
  failedOps: FailedOperation[];
  lastSyncSummary: SyncSummary | null;
  offlineMode: boolean;
  language: Language;
}

interface LegacyAnimalOp {
  kind: 'animal';
  opId: string;
  userId: string;
  queuedAt: string;
  animal: { id: string; moozzle_id: string; species: 'cattle' | 'buffalo'; breed: string; sex: 'female' | 'male'; age_years: number; owner_name?: string; owner_phone?: string; farm_name?: string; village?: string; district?: string; state?: string; captured_images_count?: number };
  template: { quality_score?: number };
}
interface LegacyServiceOp {
  kind: 'service';
  opId: string;
  userId: string;
  queuedAt: string;
  record: { id: string; animal_id: string; service_type: 'health' | 'ai' | 'insurance' | 'traceability'; title: string; date: string; technician_name: string; details: Record<string, string> };
}

/** Version 0 queued rows straight into tables; version 1 queues checked RPC payloads. */
function migrateDeviceState(persisted: unknown, version: number): AppStore {
  const state = (persisted ?? {}) as Partial<AppStore> & { syncQueue?: unknown[] };
  if (version >= 1) return state as AppStore;
  const legacy = Array.isArray(state.syncQueue) ? state.syncQueue : [];
  const syncQueue: QueuedOperation[] = [];
  for (const item of legacy) {
    const op = item as LegacyAnimalOp | LegacyServiceOp | { kind: string };
    if (op.kind === 'animal' && 'animal' in op) {
      const a = op.animal;
      syncQueue.push({
        kind: 'animal', opId: op.opId, userId: op.userId, role: 'Field Worker', queuedAt: op.queuedAt,
        payload: { id: a.id, moozzle_id: a.moozzle_id, species: a.species, breed: a.breed, sex: a.sex, age_years: a.age_years, owner_name: a.owner_name ?? '', owner_phone: a.owner_phone ?? '', farm_id: null, farm_name: a.farm_name ?? '', village: a.village ?? '', district: a.district ?? '', state: a.state ?? '', captured_images_count: a.captured_images_count ?? 5, quality_score: op.template.quality_score ?? 0.9, embeddings: [], image_paths: [], quality_scores: [], quality_metrics: [], save_as_draft: false, source: 'offline-queue' },
      });
    } else if (op.kind === 'service' && 'record' in op) {
      const r = op.record;
      syncQueue.push({ kind: 'service', opId: op.opId, userId: op.userId, role: 'Field Worker', queuedAt: op.queuedAt, moozzleId: '', payload: { id: r.id, animal_id: r.animal_id, service_type: r.service_type, title: r.title, date: r.date, technician_name: r.technician_name, details: r.details, corrects_id: null, source: 'offline-queue' } });
    }
  }
  return { ...(state as AppStore), syncQueue, failedOps: [] };
}

// Saved data and its actions only. Loading and save status is in useStorageStatus
// (store/storage.ts), which the storage below reports to.
export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      preferences: {},
      validationTrials: [],
      syncQueue: [],
      failedOps: [],
      lastSyncSummary: null,
      offlineMode: false,
      language: 'EN',
      setLanguage: (language) => set({ language }),
      setOfflineMode: (enabled) => set({ offlineMode: enabled }),
      enqueue: (operation) => set((state) => ({ syncQueue: [...state.syncQueue, operation] })),
      updateQueued: (opId, operation) =>
        set((state) => ({ syncQueue: state.syncQueue.map((item) => (item.opId === opId ? operation : item)) })),
      removeQueued: (opId) => set((state) => ({ syncQueue: state.syncQueue.filter((item) => item.opId !== opId) })),
      addFailed: (failed) =>
        set((state) => ({
          syncQueue: state.syncQueue.filter((item) => item.opId !== failed.operation.opId),
          failedOps: [failed, ...state.failedOps.filter((item) => item.operation.opId !== failed.operation.opId)],
        })),
      discardFailed: (opId) => set((state) => ({ failedOps: state.failedOps.filter((item) => item.operation.opId !== opId) })),
      requeueFailed: (opId) =>
        set((state) => {
          const failed = state.failedOps.find((item) => item.operation.opId === opId);
          if (!failed) return state;
          return { failedOps: state.failedOps.filter((item) => item.operation.opId !== opId), syncQueue: [...state.syncQueue, failed.operation] };
        }),
      setLastSyncSummary: (summary) => set({ lastSyncSummary: summary }),
      addValidationTrial: (trial) => set((state) => ({ validationTrials: [trial, ...state.validationTrials] })),
    }),
    {
      name: 'moozzle-device-v2',
      version: 1,
      migrate: migrateDeviceState,
      storage: appStorage(),
      partialize: (state) => ({
        preferences: state.preferences,
        validationTrials: state.validationTrials,
        syncQueue: state.syncQueue,
        failedOps: state.failedOps,
        lastSyncSummary: state.lastSyncSummary,
        offlineMode: state.offlineMode,
        language: state.language,
      }),
      onRehydrateStorage: trackLoading,
    }
  )
);

/** For a Retry button when useStorageStatus has phase 'error'. */
export const retryLoading = () => {
  // Reading again once loaded would replace changes that are still unsaved.
  if (useStorageStatus.getState().phase === 'error') void useAppStore.persist.rehydrate();
};

/** For a Retry button when useStorageStatus has saveFailed: saves the current data again. */
export const retrySaving = () => useAppStore.setState({});
