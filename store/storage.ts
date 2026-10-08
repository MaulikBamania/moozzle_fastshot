import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

export interface StorageStatus {
  /** 'loading' until the saved data has been read, 'error' when it could not be read. */
  phase: 'loading' | 'ready' | 'error';
  saving: boolean;
  /** The latest changes are on screen but not on the device. */
  saveFailed: boolean;
}

/**
 * Loading and save status of the saved store, for spinners, error text and Retry buttons.
 *
 * It serves the app's one saved store, useAppStore: add data there instead of
 * creating a second saved store, which would report into the same status.
 *
 * This store is separate from useAppStore and is never saved. Keep status here:
 * persist saves after every update of the store it wraps, fields left out of
 * `partialize` included. A status written to the saved store while it saves starts
 * another save, which writes the status again, and the app freezes.
 */
export const useStorageStatus = create<StorageStatus>()(() => ({
  phase: 'loading',
  saving: false,
  saveFailed: false,
}));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `storage` option of persist(): AsyncStorage that reports to useStorageStatus. */
export function appStorage<S>(): PersistStorage<S> {
  let writes: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    async getItem(name) {
      const raw = await AsyncStorage.getItem(name);
      // Nothing saved yet is a normal first launch.
      if (raw === null) return null;
      const saved: unknown = JSON.parse(raw);
      if (!isRecord(saved) || !isRecord(saved.state)) {
        throw new Error('Saved data has an unsupported format.');
      }
      return saved as unknown as StorageValue<S>;
    },
    setItem(name, value) {
      // Data that has not been read is still on the device: never save over it.
      // This also skips persist's own save after a migration; the next change saves it.
      if (useStorageStatus.getState().phase !== 'ready') return writes;
      const serialized = JSON.stringify(value);
      pending += 1;
      useStorageStatus.setState({ saving: true });
      // One write at a time, so a slow save cannot replace a newer one.
      writes = writes.then(async () => {
        try {
          await AsyncStorage.setItem(name, serialized);
          useStorageStatus.setState({ saveFailed: false });
        } catch (error) {
          console.error('Could not save app data', error);
          useStorageStatus.setState({ saveFailed: true });
        } finally {
          pending -= 1;
          useStorageStatus.setState({ saving: pending > 0 });
        }
      });
      return writes;
    },
    removeItem(name) {
      // After the saves already asked for, or one of them would bring the data back.
      const removed = writes.then(() => AsyncStorage.removeItem(name));
      writes = removed.catch(() => {
        // The caller gets the failure. Later saves must still run.
      });
      return removed;
    },
  };
}

/** The `onRehydrateStorage` option of persist(): follows the load in useStorageStatus. */
export function trackLoading<S>(): (state?: S, error?: unknown) => void {
  useStorageStatus.setState({ phase: 'loading' });
  return (_state, error) => {
    if (error) {
      // persist caught a read, parse or merge error. The saved data is untouched.
      console.error('Could not load saved app data', error);
      useStorageStatus.setState({ phase: 'error' });
    } else {
      useStorageStatus.setState({ phase: 'ready' });
    }
  };
}
