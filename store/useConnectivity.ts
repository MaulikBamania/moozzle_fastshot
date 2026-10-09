import { useEffect } from 'react';
import { create } from 'zustand';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase';
import { useAppStore } from './useAppStore';

interface ConnectivityState {
  /** null until the first check finishes. */
  reachable: boolean | null;
  checking: boolean;
  lastCheckedAt: string | null;
  check: () => Promise<boolean>;
}

const CHECK_INTERVAL_MS = 20000;
const CHECK_TIMEOUT_MS = 8000;

/** Live reachability of the Supabase backend (auth health endpoint). */
export const useConnectivity = create<ConnectivityState>()((set) => ({
  reachable: null,
  checking: false,
  lastCheckedAt: null,
  check: async () => {
    set({ checking: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    let ok = false;
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: SUPABASE_ANON_KEY },
        signal: controller.signal,
      });
      ok = response.ok;
    } catch (error) {
      console.log('Supabase connectivity check failed', error);
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    set({ reachable: ok, checking: false, lastCheckedAt: new Date().toISOString() });
    return ok;
  },
}));

/** True when writes should go straight to Supabase. */
export function useIsOnline(): boolean {
  const reachable = useConnectivity((state) => state.reachable);
  const offlineMode = useAppStore((state) => state.offlineMode);
  return !offlineMode && reachable !== false;
}

export function isOnlineNow(): boolean {
  return !useAppStore.getState().offlineMode && useConnectivity.getState().reachable !== false;
}

/** Mount once at the root: polls backend reachability. */
export function useConnectivityMonitor() {
  useEffect(() => {
    const { check } = useConnectivity.getState();
    void check();
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
