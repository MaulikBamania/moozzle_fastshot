import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage, trackLoading, useStorageStatus } from './storage';
import type { Preferences } from './types';

interface PreferencesSlice {
  preferences: Preferences;
}

export type AppStore = PreferencesSlice;

// Saved data and its actions only. Loading and save status is in useStorageStatus
// (store/storage.ts), which the storage below reports to.
export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      preferences: {},
    }),
    {
      name: 'app-storage',
      storage: appStorage(),
      partialize: (state) => ({
        preferences: state.preferences,
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
