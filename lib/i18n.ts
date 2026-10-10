import { useCallback } from 'react';
import { translate } from '@/lib/i18n-core';
import { useAppStore } from '@/store/useAppStore';

export { translate } from '@/lib/i18n-core';

/** Substitutes `{name}` placeholders after translation. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Imperative translator for code outside React (uses the persisted language). */
export function t(text: string, vars?: Record<string, string | number>): string {
  return fill(translate(useAppStore.getState().language, text), vars);
}

/** Subscribes to the selected language; components re-render when it changes. */
export function useTranslation() {
  const language = useAppStore((state) => state.language);
  const translateText = useCallback(
    (text: string, vars?: Record<string, string | number>) => fill(translate(language, text), vars),
    [language],
  );
  return { language, t: translateText };
}
