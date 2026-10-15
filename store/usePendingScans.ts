import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import type { CaptureSource } from './types';

/**
 * Captures waiting because the biometric service was unavailable (SERVICE UNAVAILABLE outcome).
 * Held in memory only: raw muzzle images are sensitive biometric data and are not written to device
 * storage. Nothing here is a decision — each item is analysed and compared from scratch when retried.
 */
export interface PendingScan {
  id: string;
  operation: 'identify' | 'verify';
  uri: string;
  source: CaptureSource;
  /** 12-digit claimed ID for 1:1 verification. */
  claimedId?: string;
  queuedAt: string;
  lastError: string;
}

interface PendingScansState {
  items: PendingScan[];
  add: (item: Omit<PendingScan, 'id' | 'queuedAt'>) => void;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<PendingScan>) => void;
}

export const MAX_PENDING_SCANS = 10;

export const usePendingScans = create<PendingScansState>()((set) => ({
  items: [],
  add: (item) =>
    set((state) => ({
      items: [{ ...item, id: Crypto.randomUUID(), queuedAt: new Date().toISOString() }, ...state.items].slice(0, MAX_PENDING_SCANS),
    })),
  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  update: (id, patch) => set((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })),
}));
