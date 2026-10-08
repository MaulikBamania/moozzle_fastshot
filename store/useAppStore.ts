import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage, trackLoading, useStorageStatus } from './storage';
import { sampleAnimals, sampleServiceRecords, sampleTemplates } from './sampleData';
import type { Animal, BiometricTemplate, Language, LivestockServiceRecord, Preferences } from './types';

interface PreferencesSlice {
  preferences: Preferences;
}

interface AnimalActions {
  addAnimal: (animal: Animal, template: BiometricTemplate) => void;
  addServiceRecord: (record: LivestockServiceRecord) => void;
  retireAnimal: (moozzleId: string, reason: string, notes: string) => void;
  setLanguage: (language: Language) => void;
}

export interface AppStore extends PreferencesSlice, AnimalActions {
  animals: Animal[];
  biometricTemplates: BiometricTemplate[];
  serviceRecords: LivestockServiceRecord[];
  language: Language;
}

// Saved data and its actions only. Loading and save status is in useStorageStatus
// (store/storage.ts), which the storage below reports to.
export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      preferences: {},
      animals: sampleAnimals,
      biometricTemplates: sampleTemplates,
      serviceRecords: sampleServiceRecords,
      language: 'EN',
      addAnimal: (animal, template) =>
        set((state) => ({
          animals: [animal, ...state.animals],
          biometricTemplates: [template, ...state.biometricTemplates],
        })),
      addServiceRecord: (record) =>
        set((state) => ({ serviceRecords: [record, ...state.serviceRecords] })),
      retireAnimal: (moozzleId, reason, notes) =>
        set((state) => ({
          animals: state.animals.map((item) =>
            item.moozzle_id === moozzleId
              ? {
                  ...item,
                  biometric_status: 'Retired',
                  current_status: 'Retired',
                  retire_reason: notes ? `${reason}: ${notes}` : reason,
                  retire_date: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              : item
          ),
        })),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'app-storage',
      storage: appStorage(),
      partialize: (state) => ({
        preferences: state.preferences,
        animals: state.animals,
        biometricTemplates: state.biometricTemplates,
        serviceRecords: state.serviceRecords,
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
