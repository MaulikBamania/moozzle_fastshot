import type { AgeGroup, AnimalType, PregnancyStatus, ProductionStatus, SettingRow, Sex, SpeciesCode } from '@/store/types';

export interface SpeciesOption {
  type: AnimalType;
  code: SpeciesCode;
  label: string;
}

export const SPECIES_OPTIONS: readonly SpeciesOption[] = [
  { type: 'Cattle', code: 'cattle', label: 'CATTLE' },
  { type: 'Buffalo', code: 'buffalo', label: 'BUFFALO' },
  { type: 'Bullock', code: 'bullock', label: 'BULLOCK' },
  { type: 'Crossbreed', code: 'crossbreed', label: 'CROSSBREED' },
];

export function speciesCode(type: AnimalType): SpeciesCode {
  return SPECIES_OPTIONS.find((item) => item.type === type)?.code ?? 'cattle';
}

export function animalTypeFromCode(code: string | null | undefined): AnimalType {
  return SPECIES_OPTIONS.find((item) => item.code === code)?.type ?? 'Cattle';
}

/** Cattle-family species (everything except buffalo) share cattle photos, filters and breed lineage. */
export function isCattleFamily(type: AnimalType): boolean {
  return type !== 'Buffalo';
}

// Existing breed lists, unchanged. Bullock and Crossbreed reuse names from the cattle list only.
const CATTLE_BREEDS = ['Gir', 'Sahiwal', 'Red Sindhi', 'Tharparkar', 'Rathi', 'Kankrej', 'Hariana', 'Jersey Cross', 'HF Cross', 'Other'];
const BUFFALO_BREEDS = ['Murrah', 'Mehsana', 'Jaffarabadi', 'Surti', 'Nili-Ravi', 'Bhadawari', 'Other'];
/** Working / draught cattle breeds from the existing list. */
const BULLOCK_BREEDS = ['Kankrej', 'Hariana', 'Tharparkar', 'Gir', 'Rathi', 'Red Sindhi', 'Sahiwal', 'Other'];
/** Dairy crossbreeds from the existing list. */
const CROSSBREED_BREEDS = ['HF Cross', 'Jersey Cross', 'Other'];

export function breedsFor(type: AnimalType | null): string[] {
  switch (type) {
    case 'Cattle':
      return CATTLE_BREEDS;
    case 'Buffalo':
      return BUFFALO_BREEDS;
    case 'Bullock':
      return BULLOCK_BREEDS;
    case 'Crossbreed':
      return CROSSBREED_BREEDS;
    default:
      return [];
  }
}

export interface AgeThresholds {
  /** Age in months at which CALF becomes YOUNG. */
  youngFrom: number;
  /** Age in months at which YOUNG becomes ADULT. */
  adultFrom: number;
}

/**
 * Reads the administrator-configured thresholds for a species from platform settings
 * (`age_group_young_from_months_<code>` / `age_group_adult_from_months_<code>`).
 * Returns null when they are missing or would overlap — the form then blocks instead of guessing.
 */
export function ageThresholdsFor(settings: readonly SettingRow[], type: AnimalType | null): AgeThresholds | null {
  if (!type) return null;
  const code = speciesCode(type);
  const read = (key: string): number | null => {
    const value = settings.find((item) => item.key === key)?.value;
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(num) ? num : null;
  };
  const youngFrom = read(`age_group_young_from_months_${code}`);
  const adultFrom = read(`age_group_adult_from_months_${code}`);
  if (youngFrom === null || adultFrom === null || youngFrom < 1 || adultFrom <= youngFrom) return null;
  return { youngFrom, adultFrom };
}

export function computeAgeGroup(years: number, months: number, thresholds: AgeThresholds | null): AgeGroup | null {
  if (!thresholds) return null;
  const total = Math.max(0, Math.round(years)) * 12 + Math.min(11, Math.max(0, Math.round(months)));
  if (total < thresholds.youngFrom) return 'CALF';
  if (total < thresholds.adultFrom) return 'YOUNG';
  return 'ADULT';
}

/** "under 12 months", "12–35 months", "36 months and older". */
export function describeAgeGroup(group: AgeGroup, thresholds: AgeThresholds): string {
  if (group === 'CALF') return `Under ${thresholds.youngFrom} months`;
  if (group === 'YOUNG') return `${thresholds.youngFrom}–${thresholds.adultFrom - 1} months`;
  return `${thresholds.adultFrom} months and older`;
}

/** Mirrors public.production_allowed(): only adult females of a dairy species can be MILK or DRY. */
export function productionAllowed(type: AnimalType | null, sex: Sex, group: AgeGroup | null): boolean {
  return type !== null && type !== 'Bullock' && sex === 'Female' && group === 'ADULT';
}

/** Mirrors public.pregnancy_allowed(): males, bullocks and calves cannot be PREGNANT. */
export function pregnancyAllowed(type: AnimalType | null, sex: Sex, group: AgeGroup | null): boolean {
  return type !== null && type !== 'Bullock' && sex === 'Female' && (group === 'YOUNG' || group === 'ADULT');
}

export const PRODUCTION_OPTIONS: readonly ProductionStatus[] = ['DRY', 'MILK', 'NA'];
export const PREGNANCY_OPTIONS: readonly PregnancyStatus[] = ['PREGNANT', 'NON-PREGNANT', 'NA'];

export function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(6)}° ${value >= 0 ? positive : negative}`;
}

/** Local date + time in the device's settings, e.g. "12 Oct 2026, 14:05". */
export function formatLocalDateTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** "UTC+05:30" for an offset in minutes east of UTC. */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Minutes east of UTC for the device's current time zone (JS reports the inverse). */
export function deviceUtcOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset();
}
