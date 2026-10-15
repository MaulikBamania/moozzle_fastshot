import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { Card, colors, EmptyState, ErrorState, LoadingState, OptionChip, Pill, PrimaryButton } from '@/components/moozzle-ui';
import { LineChart } from '@/components/performance-charts';
import { ScanLabelling } from '@/components/scan-analytics';
import { ThresholdChart } from '@/components/threshold-chart';
import { TestSessionManager, ThresholdGovernance } from '@/components/threshold-governance';
import { Fonts } from '@/constants/Typography';
import { FSA_DEFINITION } from '@/lib/analytics/fsa-definition';
import { breakdown, DEFAULT_FILTERS, distinctValues, filterEvents, filterScanRows, type PerformanceFilters, SPECIES_LABEL, TIER_LABELS } from '@/lib/analytics/filters';
import { assessGoal, GOAL_STATUS_LABELS, GOALS, type GoalStatus } from '@/lib/analytics/goals';
import { cmc, fpirFnirCurve, GALLERY_SIZES, galleryProjection, identificationSummary, identificationTrials } from '@/lib/analytics/identification';
import { curve, DATE_RANGES, equalErrorRate } from '@/lib/analytics/metrics';
import { operationalSummary } from '@/lib/analytics/operational';
import { FAR_COLOR, FRR_COLOR } from '@/lib/analytics/report';
import { formatCi, formatPct, MIN_REPORTABLE_TRIALS, type Proportion, ruleOfThree, trialsForTarget, upperBound95, wilson } from '@/lib/analytics/statistics';
import { eerFromRoc, rocPoints, verificationSummary, verificationTrials, type VerificationTrial } from '@/lib/analytics/verification';
import { fetchValidation } from '@/lib/biometric/engine';
import { CONDITION_LABELS, REASON_GUIDANCE } from '@/lib/biometric/quality';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useSession } from '@/store/useBovineStore';
import type { AgeGroup, AnimalType, CaptureCondition, DataSource, QualityReason, ScanAnalyticsPayload, ScanAnalyticsRow } from '@/store/types';

export type DashboardTab = 'verification' | 'identification' | 'quality' | 'protocol' | 'thresholds' | 'labels';

const TABS: { key: DashboardTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'verification', label: '1:1 Verification', icon: 'person-circle-outline' },
  { key: 'identification', label: '1:N Identification', icon: 'search-outline' },
  { key: 'quality', label: 'Quality & Operations', icon: 'pulse-outline' },
  { key: 'protocol', label: 'Protocol & ISO 19795-1', icon: 'flask-outline' },
  { key: 'thresholds', label: 'Thresholds & Config', icon: 'options-outline' },
  { key: 'labels', label: 'Labels & Export', icon: 'pricetags-outline' },
];

const TIERS: DataSource[] = ['laboratory', 'field_pilot', 'production'];
const SPECIES: ('All' | AnimalType)[] = ['All', 'Cattle', 'Buffalo', 'Bullock', 'Crossbreed', 'Bull'];
const AGE_GROUPS: ('All' | AgeGroup)[] = ['All', 'CALF', 'YOUNG', 'ADULT'];

const TIER_NOTE: Record<DataSource, string> = {
  laboratory: 'Controlled laboratory benchmark sessions with labelled genuine / impostor and mated / non-mated trials.',
  field_pilot: 'Controlled field-pilot sessions under real farm conditions, labelled by the session owner.',
  production: 'Live operational scans. Error rates use only scans later labelled by an authorised reviewer — an operational sample, not a controlled trial. Unlabelled scans never produce FAR, FRR, FPIR or FNIR.',
};

const GOAL_TONE: Record<GoalStatus, 'green' | 'amber' | 'red' | 'slate' | 'blue'> = {
  supported: 'green',
  not_met: 'red',
  not_demonstrated: 'amber',
  no_data: 'slate',
  no_target: 'blue',
};

export function PerformanceDashboard({ initialTab = 'verification' }: { initialTab?: DashboardTab }) {
  const session = useSession();
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [filters, setFilters] = useState<PerformanceFilters>(DEFAULT_FILTERS);
  const days = DATE_RANGES.find((item) => item.key === filters.range)?.days ?? 0;

  const fetchScans = useCallback(async () => {
    const { data, error } = await supabase.rpc('scan_analytics', { p_days: days });
    if (error) throw error;
    return normalise(data as ScanAnalyticsPayload);
  }, [days]);
  const resource = useAsyncResource(fetchScans, 'Biometric performance data could not be loaded.');
  const payload = resource.data;

  const rows = useMemo(() => (payload ? filterScanRows(payload.scans, filters) : []), [payload, filters]);
  const events = useMemo(() => (payload ? filterEvents(payload.acquisition_events, filters) : []), [payload, filters]);
  const options = useMemo(() => {
    const all = payload?.scans ?? [];
    return {
      breeds: distinctValues(all.map((r) => r.breed)),
      devices: distinctValues([...all.map((r) => r.device_model), ...(payload?.acquisition_events ?? []).map((e) => e.device_model)]),
      conditions: distinctValues(all.map((r) => r.capture_condition)),
      models: distinctValues(all.map((r) => r.model_version)),
    };
  }, [payload]);
  const set = useCallback(<K extends keyof PerformanceFilters>(key: K, value: PerformanceFilters[K]) => setFilters((f) => ({ ...f, [key]: value })), []);

  if (!payload && resource.loading) return <LoadingState label="Loading biometric performance…" />;
  if (!payload) return <ErrorState message={resource.error || 'Biometric performance data could not be loaded.'} onRetry={() => void resource.reload()} />;

  const canRun = session.role === 'Researcher' || session.role === 'Organisation Administrator' || (session.role === 'Super Administrator' && session.privileged);

  return (
    <View style={styles.stack}>
      <Card style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="speedometer-outline" size={24} color={colors.surface} /></View>
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>Biometric Performance Monitoring</Text>
          <Text style={styles.heroText}>1:1 verification and 1:N identification are measured separately and never combined. Goals are proposed validation targets, not achieved performance. Production config v{payload.config.config_version} · {payload.config.model_version} · gallery N = {payload.gallery_size} animals · scope {payload.scope}{payload.deidentified ? ' (de-identified)' : ''}.</Text>
        </View>
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.noGrow} contentContainerStyle={styles.tabRow}>
        {TABS.map((item) => (
          <OptionChip key={item.key} label={item.label} selected={tab === item.key} onPress={() => setTab(item.key)} />
        ))}
      </ScrollView>

      {tab !== 'thresholds' ? (
        <Card style={styles.filters}>
          <Text style={styles.filterLabel}>Data tier — never merged</Text>
          <View style={styles.chips}>{TIERS.map((t) => <OptionChip key={t} label={TIER_LABELS[t]} selected={filters.tier === t} onPress={() => set('tier', t)} tone="blue" />)}</View>
          <Text style={styles.muted}>{TIER_NOTE[filters.tier]}</Text>
          <Text style={styles.filterLabel}>Time period</Text>
          <View style={styles.chips}>{DATE_RANGES.map((r) => <OptionChip key={r.key} label={r.label} selected={filters.range === r.key} onPress={() => set('range', r.key)} />)}</View>
          <FilterRow label="Species" values={SPECIES} selected={filters.species} onSelect={(v) => set('species', v)} />
          <FilterRow label="Age group" values={AGE_GROUPS} selected={filters.ageGroup} onSelect={(v) => set('ageGroup', v)} />
          <FilterRow label="Breed" values={['All', ...options.breeds]} selected={filters.breed} onSelect={(v) => set('breed', v)} />
          <FilterRow label="Camera / device" values={['All', ...options.devices]} selected={filters.device} onSelect={(v) => set('device', v)} />
          <FilterRow label="Environment" values={['All', ...options.conditions]} selected={filters.condition} onSelect={(v) => set('condition', v)} format={(v) => CONDITION_LABELS[v as CaptureCondition] ?? v} />
          <FilterRow label="Model version" values={['All', ...options.models]} selected={filters.model} onSelect={(v) => set('model', v)} />
          {resource.loading ? <Text style={styles.muted}>Refreshing…</Text> : null}
          {resource.error ? <Text selectable style={styles.error}>{resource.error}</Text> : null}
        </Card>
      ) : null}

      {tab === 'verification' ? <VerificationTab rows={rows} payload={payload} tier={filters.tier} /> : null}
      {tab === 'identification' ? <IdentificationTab rows={rows} payload={payload} tier={filters.tier} /> : null}
      {tab === 'quality' ? <QualityTab rows={rows} events={events} /> : null}
      {tab === 'protocol' ? <ProtocolTab rows={rows} payload={payload} canRun={canRun} onChanged={resource.reload} /> : null}
      {tab === 'thresholds' ? <ThresholdGovernance /> : null}
      {tab === 'labels' ? <ScanLabelling payload={payload} rows={rows} tierLabel={TIER_LABELS[filters.tier]} rangeLabel={DATE_RANGES.find((r) => r.key === filters.range)?.label ?? ''} onChanged={resource.reload} /> : null}
    </View>
  );
}

function normalise(p: ScanAnalyticsPayload): ScanAnalyticsPayload {
  const num = (v: unknown, fallback: number) => (v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));
  return {
    ...p,
    config: {
      ...p.config,
      verify_accept: num(p.config?.verify_accept, 0.88),
      verify_review: num(p.config?.verify_review, 0.7),
      identify_accept: num(p.config?.identify_accept, 0.85),
      identify_review: num(p.config?.identify_review, 0.7),
      identify_margin: num(p.config?.identify_margin, 0.02),
      candidate_list_k: num(p.config?.candidate_list_k, 5),
      config_version: num(p.config?.config_version, 1),
    },
    scans: (p.scans ?? []).map((r) => ({
      ...r,
      similarity: r.similarity === null ? null : Number(r.similarity),
      quality_score: r.quality_score === null ? null : Number(r.quality_score),
      candidate_scores: (r.candidate_scores ?? []).map(Number),
      device_model: r.device_model ?? '',
      capture_condition: r.capture_condition ?? '',
      data_source: r.data_source ?? 'production',
    })),
    acquisition_events: p.acquisition_events ?? [],
    test_sessions: p.test_sessions ?? [],
  };
}

function FilterRow<T extends string>({ label, values, selected, onSelect, format }: { label: string; values: readonly T[]; selected: T; onSelect: (v: T) => void; format?: (v: T) => string }) {
  if (values.length <= 1) return null;
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.noGrow} contentContainerStyle={styles.chipsScroll}>
        {values.map((v) => <OptionChip key={v} label={format ? format(v) : v} selected={selected === v} onPress={() => onSelect(v)} />)}
      </ScrollView>
    </View>
  );
}

/** Rate tile: value, k/n, 95 % CI, and (when a goal exists) its status against the upper bound. */
function RateTile({ label, p, note, goal }: { label: string; p: Proportion; note: string; goal?: keyof typeof GOALS }) {
  const g = goal ? GOALS[goal] : null;
  const status = g ? assessGoal(p, g.target) : null;
  return (
    <View style={styles.kpi}>
      <View style={styles.kpiHead}>
        <Text style={styles.kpiLabel}>{label}</Text>
        {status ? <Pill label={GOAL_STATUS_LABELS[status]} tone={GOAL_TONE[status]} /> : null}
      </View>
      <Text selectable style={styles.kpiValue}>{formatPct(p.rate, 3)}</Text>
      <Text selectable style={styles.kpiNote}>{p.k} / {p.n} · {formatCi(p, 3)}</Text>
      {p.n > 0 && p.k === 0 ? <Text style={styles.kpiNote}>0 errors ≠ 0 risk · rule of 3 upper bound {formatPct(ruleOfThree(p.n), 3)}</Text> : null}
      {g ? <Text style={styles.kpiTarget}>Proposed goal {g.targetLabel}</Text> : null}
      {p.n > 0 && p.n < MIN_REPORTABLE_TRIALS ? <Text style={styles.warnNote}>Fewer than {MIN_REPORTABLE_TRIALS} trials — not interpretable.</Text> : null}
      <Text style={styles.kpiNote}>{note}</Text>
    </View>
  );
}

function CountTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text selectable style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiNote}>{note}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- 1:1
function VerificationTab({ rows, payload, tier }: { rows: ScanAnalyticsRow[]; payload: ScanAnalyticsPayload; tier: DataSource }) {
  const t = payload.config.verify_accept;
  const verifyRows = useMemo(() => rows.filter((r) => r.scan_type === 'verify'), [rows]);
  const trials = useMemo(() => verificationTrials(rows), [rows]);
  const summary = useMemo(() => verificationSummary(trials, t), [trials, t]);
  const roc = useMemo(() => rocPoints(trials), [trials]);
  const eer = useMemo(() => eerFromRoc(roc), [roc]);
  const points = useMemo(() => curve(trials), [trials]);
  const [picked, setPicked] = useState<number | null>(null);
  const [calibration, setCalibration] = useState(false);
  const fetchPairs = useCallback(async (): Promise<VerificationTrial[] | null> => {
    if (!calibration) return null;
    const data = await fetchValidation('overall');
    return data.pairs.map(([g, score]) => ({ genuine: g === 1, score: Number(score) }));
  }, [calibration]);
  const pairs = useAsyncResource(fetchPairs, 'Calibration template pairs could not be loaded.');
  const calSummary = useMemo(() => (pairs.data ? verificationSummary(pairs.data, t) : null), [pairs.data, t]);

  return (
    <View style={styles.stack}>
      <Text style={styles.section}>1:1 verification · claimed MOOZZLE ID vs its reference templates</Text>
      <Text style={styles.muted}>FAR = impostor comparisons accepted ÷ impostor comparisons. FRR = genuine comparisons rejected ÷ genuine comparisons. Accept threshold {t.toFixed(3)} (1:1 only). {TIER_LABELS[tier]}.</Text>
      <View style={styles.kpis}>
        <RateTile label="FAR" p={summary.far} goal="far" note={`${summary.falseAccepts} false accepts in ${summary.impostor} labelled impostor trials`} />
        <RateTile label="FRR" p={summary.frr} goal="frr" note={`${summary.falseRejects} false rejects in ${summary.genuine} labelled genuine trials`} />
        <CountTile label="EER" value={eer ? formatPct(eer.rate) : '—'} note={eer ? `FAR = FRR at ${eer.threshold.toFixed(3)}` : 'Needs genuine and impostor trials'} />
        <CountTile label="Genuine / impostor" value={`${summary.genuine} / ${summary.impostor}`} note="Labelled comparison counts" />
        <CountTile label="1:1 attempts" value={String(verifyRows.length)} note={`${trials.length} labelled · ${verifyRows.length - trials.length} unlabelled (excluded)`} />
      </View>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Sample size for the FAR goal</Text>
        <Text style={styles.body}>Demonstrating FAR ≤ {formatPct(GOALS.far.target, 4)} at 95 % confidence with zero false accepts needs at least {trialsForTarget(GOALS.far.target ?? 1e-6).toLocaleString()} independent labelled impostor comparisons (rule of three). This view has {summary.impostor.toLocaleString()}; current 95 % upper bound {formatPct(upperBound95(summary.far), 4)}.</Text>
      </Card>
      {trials.length === 0 ? (
        <EmptyState title="No labelled 1:1 trials" message="Run 1:1 verifications inside a test session (Protocol tab) and label each genuine or impostor in Labels & Export." />
      ) : (
        <>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>ROC curve (FAR vs genuine accept rate)</Text>
            {roc.length ? (
              <LineChart
                accessibilityLabel="ROC curve"
                series={[{ label: 'Genuine accept rate (1 − FRR)', color: FAR_COLOR, points: roc.map((p) => [p.far, 1 - p.frr]) }]}
                xLabel="False acceptance rate"
                yLabel="Genuine accept rate"
                xDomain={[0, 1]}
                formatX={(v) => `${Math.round(v * 100)}%`}
              />
            ) : <Text style={styles.muted}>A ROC curve needs both genuine and impostor trials.</Text>}
          </Card>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>FAR / FRR trade-off by threshold</Text>
            <ThresholdChart points={points} eer={equalErrorRate(points)} reviewThreshold={payload.config.verify_review} matchThreshold={t} selected={picked ?? Math.round(t * 100) / 100} onSelect={setPicked} />
            <Text style={styles.muted}>Select the security threshold from documented security and usability requirements, then propose it as a new configuration version.</Text>
          </Card>
        </>
      )}
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Calibration set — enrolment template pairs</Text>
        <Text style={styles.muted}>Genuine = two enrolment frames of the same animal; impostor = frames of different animals. These are the gallery’s own enrolment images, so they are calibration data only, never an independent evaluation.</Text>
        {!calibration ? <PrimaryButton label="Load Calibration Pairs" variant="outline" onPress={() => setCalibration(true)} /> : null}
        {calibration && pairs.loading ? <LoadingState label="Loading calibration pairs…" /> : null}
        {calibration && pairs.error ? <ErrorState message={pairs.error} onRetry={() => void pairs.reload()} /> : null}
        {calSummary ? (
          <View style={styles.kpis}>
            <RateTile label="Calibration FAR" p={calSummary.far} note={`${calSummary.impostor} impostor pairs`} />
            <RateTile label="Calibration FRR" p={calSummary.frr} note={`${calSummary.genuine} genuine pairs`} />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------- 1:N
function IdentificationTab({ rows, payload, tier }: { rows: ScanAnalyticsRow[]; payload: ScanAnalyticsPayload; tier: DataSource }) {
  const t = payload.config.identify_accept;
  const k = payload.config.candidate_list_k;
  const searches = useMemo(() => rows.filter((r) => r.scan_type === 'identify'), [rows]);
  const trials = useMemo(() => identificationTrials(rows), [rows]);
  const s = useMemo(() => identificationSummary(trials, t, k), [trials, t, k]);
  const curvePts = useMemo(() => fpirFnirCurve(trials, k), [trials, k]);
  const ranks = useMemo(() => cmc(trials, k), [trials, k]);
  const uncertain = searches.filter((r) => r.outcome === 'uncertain').length;
  const impostor = useMemo(() => verificationTrials(rows).filter((v) => !v.genuine), [rows]);
  const falseMatches = impostor.filter((v) => v.score >= t).length;
  const projection = useMemo(() => galleryProjection(falseMatches, impostor.length, [...GALLERY_SIZES, payload.gallery_size].sort((a, b) => a - b)), [falseMatches, impostor.length, payload.gallery_size]);
  const byGallery = useMemo(
    () => breakdown(rows.filter((r) => r.scan_type === 'identify' && r.mated === false), (r) => galleryBucket(r.templates_searched), (group) => {
      const g = identificationSummary(identificationTrials(group), t, k);
      return { value: g.fpir, n: g.nonMated };
    }),
    [rows, t, k],
  );

  return (
    <View style={styles.stack}>
      <Text style={styles.section}>1:N identification · search of the whole enrolled gallery</Text>
      <Text style={styles.muted}>Accept threshold {t.toFixed(3)}, candidate list k = {k}, margin {payload.config.identify_margin.toFixed(3)} (1:N only). {TIER_LABELS[tier]}. FSA / FSR is defined as FPIR — see the Protocol tab.</Text>
      <View style={styles.kpis}>
        <RateTile label="FPIR (= FSR)" p={s.fpir} goal="fpir" note={`${s.fpir.k} of ${s.nonMated} non-mated searches selected a candidate ≥ ${t.toFixed(2)}`} />
        <RateTile label="FNIR" p={s.fnir} goal="fnir" note={`${s.fnir.k} of ${s.mated} mated searches missed the true mate in top ${k}`} />
        <RateTile label="Rank-1 identification rate" p={s.rank1} note="Mate returned first with score ≥ threshold" />
        <RateTile label={`Rank-${k} identification rate`} p={s.rankK} note={`Mate within top ${k} with score ≥ threshold`} />
        <RateTile label="Uncertain-match rate" p={wilson(uncertain, searches.length)} goal="uncertain" note="REVIEW REQUIRED share of all 1:N searches (operational)" />
        <CountTile label="Mated / non-mated" value={`${s.mated} / ${s.nonMated}`} note={`${searches.length} searches · ${trials.length} labelled`} />
        <CountTile label="Gallery size now" value={payload.gallery_size.toLocaleString()} note="Enrolled active animals (N)" />
      </View>
      {trials.length === 0 ? <EmptyState title="No labelled 1:N searches" message="Label 1:N searches as mated (with the true MOOZZLE ID) or non-mated in Labels & Export to measure FPIR and FNIR." /> : (
        <>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>FPIR / FNIR by threshold (k = {k})</Text>
            <LineChart
              accessibilityLabel="FPIR and FNIR by threshold"
              series={[
                { label: 'FPIR (non-mated selected)', color: FAR_COLOR, points: curvePts.filter((p) => p.fpir !== null).map((p) => [p.threshold, p.fpir as number]) },
                { label: 'FNIR (mated missed)', color: FRR_COLOR, dashed: true, points: curvePts.filter((p) => p.fnir !== null).map((p) => [p.threshold, p.fnir as number]) },
              ]}
              xLabel="Similarity threshold"
              yLabel="Rate"
              xDomain={[0.5, 0.99]}
              markers={[{ x: t, label: `Accept ${t.toFixed(2)}` }]}
            />
          </Card>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Candidate ranking (CMC, threshold-free)</Text>
            {ranks.map((r) => <TableRow key={r.rank} cells={[`Rank ≤ ${r.rank}`, formatPct(r.rate)]} />)}
          </Card>
        </>
      )}
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Gallery size scaling (modelled)</Text>
        <Text style={styles.muted}>FPIR(N) ≈ 1 − (1 − FMR)^N, from {impostor.length} labelled 1:1 impostor comparisons at the 1:N threshold ({falseMatches} false matches) in this tier. A projection assuming independent comparisons — it must be confirmed by measured 1:N tests at the intended production gallery size.</Text>
        <TableRow header cells={['Gallery N', 'Expected FPIR', '95% upper FPIR']} />
        {projection.map((p) => <TableRow key={p.n} highlight={p.n === payload.gallery_size} cells={[`${p.n.toLocaleString()}${p.n === payload.gallery_size ? ' (now)' : ''}`, formatPct(p.expected, 3), formatPct(p.upper, 3)]} />)}
      </Card>
      {byGallery.length ? (
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Measured FPIR by gallery size at search time</Text>
          <TableRow header cells={['Templates searched', 'FPIR', 'n']} />
          {byGallery.map((b) => <TableRow key={b.label} cells={[b.label, b.sufficient ? formatPct(b.value.rate) : `${formatPct(b.value.rate)} (insufficient)`, String(b.n)]} />)}
        </Card>
      ) : null}
    </View>
  );
}

function galleryBucket(n: number): string {
  if (n < 100) return '< 100';
  if (n < 1000) return '100–999';
  if (n < 10000) return '1,000–9,999';
  if (n < 100000) return '10,000–99,999';
  return '≥ 100,000';
}

// ---------------------------------------------------------------- Quality & operational
function QualityTab({ rows, events }: { rows: ScanAnalyticsRow[]; events: ScanAnalyticsPayload['acquisition_events'] }) {
  const o = useMemo(() => operationalSummary(rows, events), [rows, events]);
  const ops = [['1:N identify', o.byOperation.identify], ['1:1 verify', o.byOperation.verify], ['Enrolment', o.byOperation.enrol]] as const;
  return (
    <View style={styles.stack}>
      <Text style={styles.section}>Acquisition & operations · reported apart from matching errors</Text>
      <View style={styles.kpis}>
        <CountTile label="Total biometric attempts" value={o.totalAttempts.toLocaleString()} note="Comparisons + rejected captures + service outages" />
        <RateTile label="FTA (all operations)" p={combinedFta(o)} goal="fta" note="Frames rejected by the quality pre-check ÷ all captured frames" />
        <RateTile label="FTE" p={o.fte} goal="fte" note={`${o.fteEvents} failed enrolment sessions · ${o.enrolmentChecks} completed duplicate checks`} />
        <CountTile label="Service outages" value={String(o.serviceOutages)} note="SERVICE UNAVAILABLE — not a decision, not an FTA" />
        <RateTile label="Manual-review resolution" p={o.reviewResolution} note={`${o.reviewResolved} of ${o.reviewRequested} review requests resolved`} />
      </View>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>By operation</Text>
        <TableRow header cells={['Operation', 'Compared', 'Confirmed', 'Review', 'No match', 'FTA', 'Uncertain']} />
        {ops.map(([label, op]) => <TableRow key={label} cells={[label, String(op.comparisons), String(op.confirmed), String(op.review), String(op.noMatch), `${formatPct(op.fta.rate)} (${op.ftaEvents})`, formatPct(op.uncertain.rate)]} />)}
        <Text style={styles.muted}>Enrolment “Confirmed” = duplicate blocked; “Review” = possible duplicate held or submitted for review.</Text>
      </Card>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Manual-review outcomes</Text>
        <TableRow cells={['Identity confirmed by reviewer', String(o.reviewDecisions.confirmed)]} />
        <TableRow cells={['Rejected (no match)', String(o.reviewDecisions.rejected)]} />
        <TableRow cells={['Inconclusive (recapture)', String(o.reviewDecisions.inconclusive)]} />
        <TableRow cells={['Awaiting a reviewer', String(o.reviewRequested - o.reviewResolved)]} />
      </Card>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Image-quality failure causes</Text>
        {o.qualityReasons.length === 0 ? <Text style={styles.muted}>No acquisition failures recorded for these filters.</Text> : o.qualityReasons.map((r) => (
          <TableRow key={r.code} cells={[REASON_GUIDANCE[r.code as QualityReason]?.cause ?? r.code, String(r.count)]} />
        ))}
      </Card>
    </View>
  );
}

function combinedFta(o: ReturnType<typeof operationalSummary>): Proportion {
  const k = o.byOperation.identify.ftaEvents + o.byOperation.verify.ftaEvents + o.byOperation.enrol.ftaEvents;
  const accepted = o.byOperation.identify.acceptedFrames + o.byOperation.verify.acceptedFrames + o.byOperation.enrol.acceptedFrames;
  return wilson(k, k + accepted);
}

// ---------------------------------------------------------------- Protocol & compliance
function ProtocolTab({ rows, payload, canRun, onChanged }: { rows: ScanAnalyticsRow[]; payload: ScanAnalyticsPayload; canRun: boolean; onChanged: () => Promise<void> }) {
  const all = payload.scans;
  const tierCounts = TIERS.map((tier) => {
    const tr = all.filter((r) => r.data_source === tier);
    const v = verificationTrials(tr);
    const i = identificationTrials(tr);
    return { tier, genuine: v.filter((x) => x.genuine).length, impostor: v.filter((x) => !x.genuine).length, mated: i.filter((x) => x.mated).length, nonMated: i.filter((x) => !x.mated).length };
  });
  const v = verificationSummary(verificationTrials(rows), payload.config.verify_accept);
  const id = identificationSummary(identificationTrials(rows), payload.config.identify_accept, payload.config.candidate_list_k);
  const leaks = payload.test_sessions.filter((s) => s.subject_overlap > 0);
  const bySpecies = breakdown(rows.filter((r) => r.scan_type === 'verify' && r.ground_truth), (r) => (r.species_code ? SPECIES_LABEL[r.species_code] : null), (g) => {
    const sm = verificationSummary(verificationTrials(g), payload.config.verify_accept);
    return { value: sm.far, n: sm.impostor };
  });
  const goalRows: [string, Proportion][] = [['far', v.far], ['frr', v.frr], ['fpir', id.fpir], ['fnir', id.fnir]];

  return (
    <View style={styles.stack}>
      <Text style={styles.section}>Validation goals — proposed, not claimed</Text>
      <Card style={styles.card}>
        <TableRow header cells={['Metric', 'Operation', 'Proposed goal', 'Status (filtered tier)']} />
        {goalRows.map(([key, p]) => {
          const g = GOALS[key as keyof typeof GOALS];
          return <TableRow key={key} cells={[g.metric, g.operation, g.targetLabel, `${GOAL_STATUS_LABELS[assessGoal(p, g.target)]} · n ${p.n}`]} />;
        })}
        {(['fta', 'fte', 'uncertain'] as const).map((key) => <TableRow key={key} cells={[GOALS[key].metric, GOALS[key].operation, GOALS[key].targetLabel, 'See Quality & Operations']} />)}
        <Text style={styles.muted}>A goal is “statistically supported” only when the 95 % upper confidence bound of controlled, labelled evaluation data is at or below it. No accuracy claim may be published until results are independently reviewed.</Text>
      </Card>

      <Text style={styles.section}>Sample sizes by data tier (all filters except tier ignored)</Text>
      <Card style={styles.card}>
        <TableRow header cells={['Tier', '1:1 genuine', '1:1 impostor', '1:N mated', '1:N non-mated']} />
        {tierCounts.map((c) => <TableRow key={c.tier} cells={[TIER_LABELS[c.tier], String(c.genuine), String(c.impostor), String(c.mated), String(c.nonMated)]} />)}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Statistical method</Text>
        <Text style={styles.body}>• Rates are k / n with 95 % Wilson score intervals; sample sizes are always shown.</Text>
        <Text style={styles.body}>• With zero observed errors the one-sided 95 % upper bound is 3 / n (rule of three). Zero errors never establishes zero risk.</Text>
        <Text style={styles.body}>• FAR ≤ 0.0001 % needs ≥ {trialsForTarget(1e-6).toLocaleString()} error-free independent impostor comparisons; FRR ≤ 5 % needs ≥ {trialsForTarget(0.05).toLocaleString()} error-free genuine comparisons (more if errors occur).</Text>
        <Text style={styles.body}>• Groups with fewer than {MIN_REPORTABLE_TRIALS} trials are flagged as insufficient.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>ISO/IEC 19795-1 aligned protocol checklist</Text>
        {[
          'Separate training, calibration and independent evaluation datasets (session split recorded per scan).',
          'No animal in both calibration and evaluation splits (leakage check below).',
          'Different animals, repeat captures, species, breeds, ages, devices and field conditions represented.',
          'Same validated preprocessing for enrolment and recognition (shared on-device pipeline).',
          'Failed acquisitions excluded from matching rates and reported as FTA / FTE.',
          '1:1 and 1:N evaluated with separate metrics, thresholds and gallery sizes.',
          'Results reported with sample sizes and confidence intervals; independent review before public claims.',
        ].map((line) => <Text key={line} style={styles.body}>✓ {line}</Text>)}
        {leaks.length ? <Text style={styles.error}>Leakage detected in {leaks.length} session(s) — see below.</Text> : <Text style={styles.ok}>No calibration / evaluation subject overlap detected.</Text>}
      </Card>

      {bySpecies.length ? (
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>1:1 FAR by species (current filters)</Text>
          <TableRow header cells={['Species', 'FAR', 'Impostor n']} />
          {bySpecies.map((b) => <TableRow key={b.label} cells={[b.label, b.sufficient ? formatPct(b.value.rate, 3) : 'Insufficient data', String(b.n)]} />)}
          <Text style={styles.muted}>Use the filters above for age group, breed, device, environment, model version and period.</Text>
        </Card>
      ) : null}

      <FsaDefinitionCard />

      <Text style={styles.section}>Controlled test sessions</Text>
      <TestSessionManager sessions={payload.test_sessions} canRun={canRun} onChanged={onChanged} />
    </View>
  );
}

/** Formal FSA / FSR definition, shown on screen exactly as documented in lib/analytics/fsa-definition.ts. */
export function FsaDefinitionCard() {
  const d = FSA_DEFINITION;
  return (
    <Card style={styles.card}>
      <View style={styles.kpiHead}><Text style={styles.cardTitle}>{d.abbreviation}: {d.name}</Text><Pill label={`Reported as ${d.reportedAs}`} tone="blue" /></View>
      <Text style={styles.meta}>{d.status}</Text>
      <Text style={styles.body}>{d.definition}</Text>
      <Text style={styles.kicker}>FALSE SELECTION</Text>
      <Text style={styles.body}>{d.falseSelection}</Text>
      <Text style={styles.kicker}>FORMULA</Text>
      <Text selectable style={styles.formula}>{d.formula}</Text>
      <Text style={styles.body}>Numerator — {d.numerator}</Text>
      <Text style={styles.body}>Denominator — {d.denominator}</Text>
      {d.parameters.map((p) => <Text key={p} style={styles.body}>• {p}</Text>)}
      <Text style={styles.body}>Applies to: {d.appliesTo}. Does not apply to: {d.doesNotApplyTo}.</Text>
      <Text style={styles.kicker}>TEST PROTOCOL</Text>
      {d.protocol.map((p, i) => <Text key={p} style={styles.body}>{i + 1}. {p}</Text>)}
      <Text style={styles.kicker}>ACCEPTANCE THRESHOLD</Text>
      <Text style={styles.body}>{d.acceptanceThreshold}</Text>
      <Text style={styles.kicker}>1:1 FAR vs 1:N FPIR / FSR</Text>
      <TableRow header cells={['Metric', 'Operation', 'Question', 'Formula']} />
      {d.distinction.map((row) => <TableRow key={row.metric} cells={[row.metric, row.operation, row.question, row.formula]} />)}
    </Card>
  );
}

function TableRow({ cells, header = false, highlight = false }: { cells: string[]; header?: boolean; highlight?: boolean }) {
  return (
    <View style={[styles.tr, header && styles.thRow, highlight && styles.trHighlight]}>
      {cells.map((cell, i) => <Text key={`${i}-${cell}`} selectable style={[header ? styles.th : styles.td, i === 0 && styles.tdFirst]}>{cell}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  noGrow: { flexGrow: 0 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0B2735', borderColor: '#0B2735' },
  heroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 18 },
  heroText: { color: 'rgba(255,255,255,0.85)', fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  tabRow: { gap: 8, paddingVertical: 2 },
  filters: { gap: 8 },
  filterGroup: { gap: 6 },
  filterLabel: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipsScroll: { gap: 8 },
  section: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 6 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  body: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19 },
  meta: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  kicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1, marginTop: 4 },
  formula: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14, backgroundColor: colors.slateLight, borderRadius: 8, padding: 10, fontVariant: ['tabular-nums'] },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  card: { gap: 8 },
  cardTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15, flexShrink: 1 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { flexGrow: 1, flexBasis: 200, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 3, boxShadow: '0 2px 10px rgba(15, 23, 42, 0.05)' },
  kpiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
  kpiLabel: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.6 },
  kpiValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24, fontVariant: ['tabular-nums'] },
  kpiTarget: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 11 },
  kpiNote: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 15 },
  warnNote: { color: colors.warning, fontFamily: Fonts.semiBold, fontSize: 11 },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingVertical: 6, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  thRow: { backgroundColor: colors.primaryLight, paddingHorizontal: 6, borderRadius: 6 },
  trHighlight: { backgroundColor: '#FEF9C3' },
  th: { flex: 1, color: colors.primaryDark, fontFamily: Fonts.bold, fontSize: 11 },
  td: { flex: 1, color: colors.text, fontFamily: Fonts.regular, fontSize: 12, fontVariant: ['tabular-nums'] },
  tdFirst: { fontFamily: Fonts.semiBold },
});
