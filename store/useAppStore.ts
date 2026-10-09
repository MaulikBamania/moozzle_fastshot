import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage, trackLoading, useStorageStatus } from './storage';
import type { Language, Preferences, QueuedOperation, SyncSummary, ValidationTrial } from './types';

interface AppActions {
  setLanguage: (language: Language) => void;
  setOfflineMode: (enabled: boolean) => void;
  enqueue: (operation: QueuedOperation) => void;
  updateQueued: (opId: string, operation: QueuedOperation) => void;
  removeQueued: (opId: string) => void;
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
  lastSyncSummary: SyncSummary | null;
  offlineMode: boolean;
  language: Language;
}

// Saved data and its actions only. Loading and save status is in useStorageStatus
// (store/storage.ts), which the storage below reports to.
export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      preferences: {},
      validationTrials: [],
      syncQueue: [],
      lastSyncSummary: null,
      offlineMode: false,
      language: 'EN',
      setLanguage: (language) => set({ language }),
      setOfflineMode: (enabled) => set({ offlineMode: enabled }),
      enqueue: (operation) => set((state) => ({ syncQueue: [...state.syncQueue, operation] })),
      updateQueued: (opId, operation) =>
        set((state) => ({ syncQueue: state.syncQueue.map((item) => (item.opId === opId ? operation : item)) })),
      removeQueued: (opId) => set((state) => ({ syncQueue: state.syncQueue.filter((item) => item.opId !== opId) })),
      setLastSyncSummary: (summary) => set({ lastSyncSummary: summary }),
      addValidationTrial: (trial) => set((state) => ({ validationTrials: [trial, ...state.validationTrials] })),
    }),
    {
      name: 'moozzle-device-v2',
      storage: appStorage(),
      partialize: (state) => ({
        preferences: state.preferences,
        validationTrials: state.validationTrials,
        syncQueue: state.syncQueue,
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
