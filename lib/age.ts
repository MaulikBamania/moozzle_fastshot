export const AGE_MAX_YEARS = 25;
export const AGE_MAX_MONTHS = 11;

export interface AnimalAge {
  years: number;
  months: number;
}

function clampInt(value: number | null | undefined, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** Normalises stored values; records created before months existed read as 0 months. */
export function toAge(years: number | null | undefined, months?: number | null): AnimalAge {
  return { years: clampInt(years, 99), months: clampInt(months, AGE_MAX_MONTHS) };
}

/** "4 years 6 months", "8 months", "1 year", "Under 1 month". */
export function formatAge(years: number | null | undefined, months?: number | null): string {
  const age = toAge(years, months);
  const parts: string[] = [];
  if (age.years > 0) parts.push(`${age.years} ${age.years === 1 ? 'year' : 'years'}`);
  if (age.months > 0) parts.push(`${age.months} ${age.months === 1 ? 'month' : 'months'}`);
  return parts.length > 0 ? parts.join(' ') : 'Under 1 month';
}

/** Compact form for dense rows: "3y 6m", "8m", "5y", "<1m". */
export function formatAgeShort(years: number | null | undefined, months?: number | null): string {
  const age = toAge(years, months);
  const parts: string[] = [];
  if (age.years > 0) parts.push(`${age.years}y`);
  if (age.months > 0) parts.push(`${age.months}m`);
  return parts.length > 0 ? parts.join(' ') : '<1m';
}

/** Decimal years for CSV exports, e.g. 4 years 6 months → 4.5. */
export function ageInYears(years: number | null | undefined, months?: number | null): number {
  const age = toAge(years, months);
  return Math.round((age.years + age.months / 12) * 100) / 100;
}
