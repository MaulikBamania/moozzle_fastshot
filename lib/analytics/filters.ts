import type { AcquisitionEventRow, AgeGroup, AnimalType, DataSource, ScanAnalyticsRow, SpeciesCode } from '@/store/types';
import { type DateRange, inRange } from './metrics';
import { MIN_REPORTABLE_TRIALS } from './statistics';

export const TIER_LABELS: Record<DataSource, string> = {
  laboratory: 'Laboratory benchmark',
  field_pilot: 'Field pilot',
  production: 'Production operations',
};

export const SPECIES_LABEL: Record<SpeciesCode, AnimalType> = {
  cattle: 'Cattle',
  buffalo: 'Buffalo',
  crossbreed: 'Crossbreed',
  bull: 'Bull',
  bullock: 'Bullock',
};

export interface PerformanceFilters {
  range: DateRange;
  tier: DataSource;
  species: 'All' | AnimalType;
  ageGroup: 'All' | AgeGroup;
  breed: string;
  device: string;
  condition: string;
  model: string;
}

export const DEFAULT_FILTERS: PerformanceFilters = { range: '30d', tier: 'production', species: 'All', ageGroup: 'All', breed: 'All', device: 'All', condition: 'All', model: 'All' };

export function filterScanRows(rows: ScanAnalyticsRow[], f: PerformanceFilters): ScanAnalyticsRow[] {
  return rows.filter((row) =>
    row.data_source === f.tier &&
    inRange(row.created_at, f.range) &&
    (f.species === 'All' || (row.species_code !== null && SPECIES_LABEL[row.species_code] === f.species)) &&
    (f.ageGroup === 'All' || row.age_group === f.ageGroup) &&
    (f.breed === 'All' || row.breed === f.breed) &&
    (f.device === 'All' || row.device_model === f.device) &&
    (f.condition === 'All' || row.capture_condition === f.condition) &&
    (f.model === 'All' || row.model_version === f.model),
  );
}

/** Acquisition events have no animal identity, so species / age / breed filters do not apply to them. */
export function filterEvents(events: AcquisitionEventRow[], f: PerformanceFilters): AcquisitionEventRow[] {
  return events.filter((event) =>
    event.data_source === f.tier &&
    inRange(event.created_at, f.range) &&
    (f.device === 'All' || event.device_model === f.device) &&
    (f.condition === 'All' || event.capture_condition === f.condition) &&
    (f.model === 'All' || event.model_version === f.model),
  );
}

export function distinctValues(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

export interface Breakdown<T> {
  label: string;
  value: T;
  n: number;
  sufficient: boolean;
}

/** Groups rows and computes a metric per group; groups below the reportable minimum are flagged. */
export function breakdown<T>(rows: ScanAnalyticsRow[], keyOf: (row: ScanAnalyticsRow) => string | null, compute: (group: ScanAnalyticsRow[]) => { value: T; n: number }): Breakdown<T>[] {
  const groups = new Map<string, ScanAnalyticsRow[]>();
  for (const row of rows) {
    const key = keyOf(row) || 'Unrecorded';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([label, group]) => {
      const { value, n } = compute(group);
      return { label, value, n, sufficient: n >= MIN_REPORTABLE_TRIALS };
    })
    .sort((a, b) => b.n - a.n);
}
