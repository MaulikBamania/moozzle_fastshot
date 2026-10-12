import { createElement, type ComponentProps, type ReactNode } from 'react';
import { Text as NativeText, TextInput as NativeTextInput } from 'react-native';
import { translate } from '@/lib/i18n-core';
import { useAppStore } from '@/store/useAppStore';
import type { Language } from '@/store/types';

/** Translates string children; arrays stay static children so element keys are untouched. */
function translateChildren(children: ReactNode, language: Language): ReactNode[] {
  if (typeof children === 'string') return [translate(language, children)];
  if (!Array.isArray(children)) return [children];
  // A sentence split around values ("Frame {n} of {n}") is translated as a whole first.
  if (children.every((child) => typeof child === 'string' || typeof child === 'number')) {
    const joined = children.join('');
    const whole = translate(language, joined);
    if (whole !== joined) return [whole];
  }
  return children.map((child: ReactNode) => (typeof child === 'string' ? translate(language, child) : child));
}

/**
 * Drop-in replacement for React Native's Text: string children and the
 * accessibility label are rendered in the language chosen in the header.
 */
export function Text({ children, accessibilityLabel, ...props }: ComponentProps<typeof NativeText>) {
  const language = useAppStore((state) => state.language);
  const label = accessibilityLabel ? translate(language, accessibilityLabel) : undefined;
  return createElement(NativeText, { ...props, accessibilityLabel: label }, ...translateChildren(children, language));
}

/** TextInput whose placeholder follows the selected language. */
export function TextInput({ placeholder, accessibilityLabel, ...props }: ComponentProps<typeof NativeTextInput>) {
  const language = useAppStore((state) => state.language);
  return (
    <NativeTextInput
      placeholder={placeholder ? translate(language, placeholder) : undefined}
      accessibilityLabel={accessibilityLabel ? translate(language, accessibilityLabel) : undefined}
      {...props}
    />
  );
}
