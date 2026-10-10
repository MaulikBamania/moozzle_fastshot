import { PHRASES } from '@/lib/i18n-phrases';
import type { Language } from '@/store/types';

/**
 * Phrase-keyed translation system.
 *
 * Every dictionary entry is keyed by its English source text (case-insensitive,
 * whitespace-collapsed), so screens keep readable English in code and the
 * translating <Text> primitive (components/translated-text.tsx) swaps it at
 * render time. Entries containing `{x}` are patterns for interpolated strings
 * (e.g. "Capture Frame {x}"; `{n}` captures digits only); captured values are translated recursively so
 * embedded role / status / breed names are localised too.
 */

type TargetLanguage = Exclude<Language, 'EN'>;

interface Pattern {
  regex: RegExp;
  hi: string;
  gu: string;
  weight: number;
}

// Case-sensitive entries win ("REGISTER ANIMAL" vs "Register Animal"); the lower-cased map is the fallback.
const exactCase: Record<TargetLanguage, Map<string, string>> = { HI: new Map(), GU: new Map() };
const exact: Record<TargetLanguage, Map<string, string>> = { HI: new Map(), GU: new Map() };
const patterns: Pattern[] = [];

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const normalise = (text: string): string => collapse(text).toLowerCase();
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PLACEHOLDER = /\{[xn]\}/g;

for (const [en, hi, gu] of PHRASES) {
  if (/\{[xn]\}/.test(en)) {
    const compact = collapse(en);
    const literals = compact.split(PLACEHOLDER).map(escapeRegex);
    const slots = compact.match(PLACEHOLDER) ?? [];
    const source = literals.reduce((acc, part, i) => acc + part + (i < slots.length ? (slots[i] === '{n}' ? '(\\d+(?:[.,]\\d+)?)' : '(.+?)') : ''), '');
    patterns.push({ regex: new RegExp(`^${source}$`, 'i'), hi, gu, weight: compact.replace(PLACEHOLDER, '').length });
  } else {
    const key = normalise(en);
    if (!exact.HI.has(key)) {
      exact.HI.set(key, hi);
      exact.GU.set(key, gu);
    }
    exactCase.HI.set(collapse(en), hi);
    exactCase.GU.set(collapse(en), gu);
  }
}
// Most specific (longest literal text) patterns win.
patterns.sort((a, b) => b.weight - a.weight);

// Leading / trailing separators used when JSX splits a sentence around values.
const EDGE = /^([\s·•:;,.()[\]“”"'—–\-+/|✓]*)([\s\S]*?)([\s·•:;,.()[\]“”"'—–\-+/|✓]*)$/;
const CACHE_LIMIT = 4000;
const cache: Record<TargetLanguage, Map<string, string>> = { HI: new Map(), GU: new Map() };

function lookup(language: TargetLanguage, text: string, depth: number): string | null {
  const key = normalise(text);
  if (!key || !/[a-z]/i.test(key)) return null;
  const direct = exactCase[language].get(collapse(text)) ?? exact[language].get(key);
  if (direct !== undefined) return direct;
  if (depth > 2) return null;
  const compact = collapse(text);
  for (const pattern of patterns) {
    const match = pattern.regex.exec(compact);
    if (!match) continue;
    let index = 0;
    const template = language === 'HI' ? pattern.hi : pattern.gu;
    return template.replace(PLACEHOLDER, () => {
      index += 1;
      const value = match[index] ?? '';
      return lookup(language, value, depth + 1) ?? value;
    });
  }
  return null;
}

/** Translates English UI text into `language`; unknown text is returned unchanged. */
export function translate(language: Language, text: string): string {
  if (language === 'EN' || !text) return text;
  const cached = cache[language].get(text);
  if (cached !== undefined) return cached;
  let result = lookup(language, text, 0);
  if (result === null) {
    const [, lead = '', core = '', trail = ''] = EDGE.exec(text) ?? [];
    const translated = core && core !== text ? lookup(language, core, 0) : null;
    result = translated === null ? text : `${lead}${translated}${trail}`;
  }
  if (cache[language].size > CACHE_LIMIT) cache[language].clear();
  cache[language].set(text, result);
  return result;
}
