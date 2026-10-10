import { create } from 'zustand';
import type { MuzzleAnalysis } from '@/store/types';

/** In-memory hand-off of an accepted Identify frame into the Register wizard (never persisted). */
interface CaptureHandoffState {
  frame: MuzzleAnalysis | null;
  setFrame: (frame: MuzzleAnalysis | null) => void;
}

export const useCaptureHandoff = create<CaptureHandoffState>()((set) => ({
  frame: null,
  setFrame: (frame) => set({ frame }),
}));
