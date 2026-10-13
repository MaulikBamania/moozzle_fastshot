import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { Card, colors, EmptyState, ErrorState, LoadingState, OptionChip, Pill, PrimaryButton } from '@/components/moozzle-ui';
import { ThresholdChart } from '@/components/threshold-chart';
import { Fonts } from '@/constants/Typography';
import { exportCsvFile, exportReportPdf } from '@/lib/analytics/export';
import {
  benchmark,
  curve,
  DATE_RANGES,
  equalErrorRate,
  FAR_TARGET,
  filterScans,
  formatRate,
  formatScore,
  formatTimestamp,
  FRR_TARGET,
  SCAN_TYPE_LABELS,
  SPECIES_FILTERS,
  summarise,
  trialsFromScans,
  trialsNeeded,
  truthForVerdict,
  verdictChoices,
  verdictOf,
  type BenchmarkState,
  type DateRange,
  type SpeciesFilter,
  type Trial,
} from '@/lib/analytics/metrics';
import { buildCsv, buildReportHtml, csvFileName, reportFileName } from '@/lib/analytics/report';
import { fetchValidation } from '@/lib/biometric/engine';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { logAudit, messageOf, useSession } from '@/store/useBovineStore';
import type { GroundTruth, ScanAnalyticsPayload, ScanAnalyticsRow, ScanVerdict } from '@/store/types';

type CurveSource = 'live' | 'templates';
type LogFilter = 'all' | 'unlabelled' | 'errors';
const PAGE = 20;

const SCOPE_LABELS: Record<ScanAnalyticsPayload['scope'], string> = {
  own: 'Your scans',
  organisation: 'Your organisation',
  platform: 'Entire platform (privileged)',
};

const VERDICT_TONE: Record<ScanVerdict, 'green' | 'red' | 'slate'> = {
  'True Match': 'green',
  'True Non-Match': 'green',
  'False Accept': 'red',
  'False Reject': 'red',
  Unlabelled: 'slate',
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalise(payload: ScanAnalyticsPayload): ScanAnalyticsPayload {
  return {
    ...payload,
    match_threshold: Number(payload.match_threshold),
    review_threshold: Number(payload.review_threshold),
    verify_threshold: Number(payload.verify_threshold),
    scans: (payload.scans ?? []).map((row) => ({ ...row, similarity: toNumber(row.similarity), quality_score: toNumber(row.quality_score), processing_ms: toNumber(row.processing_ms) })),
  };
}

export function ScanAnalytics() {
  const session = useSession();
  const [range, setRange] = useState<DateRange>('30d');
  const [species, setSpecies] = useState<SpeciesFilter>('All');
  const [source, setSource] = useState<CurveSource>('live');
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);

  const days = DATE_RANGES.find((item) => item.key === range)?.days ?? 0;
  const fetchScans = useCallback(async () => {
    const { data, error } = await supabase.rpc('scan_analytics', { p_days: days });
    if (error) throw error;
    return normalise(data as ScanAnalyticsPayload);
  }, [days]);
  const scans = useAsyncResource(fetchScans, 'Scan analytics could not be loaded.');

  const fetchPairs = useCallback(async (): Promise<Trial[] | null> => {
    if (source !== 'templates') return null;
    const payload = await fetchValidation('overall');
    return payload.pairs.map(([genuine, score]) => ({ genuine: genuine === 1, score: Number(score) }));
  }, [source]);
  const pairs = useAsyncResource(fetchPairs, 'Enrolled template pairs could not be loaded.');

  const payload = scans.data;
  const rows = useMemo(() => (payload ? filterScans(payload.scans, range, species) : []), [payload, range, species]);
  const summary = useMemo(() => summarise(rows), [rows]);
  const liveTrials = useMemo(() => trialsFromScans(rows), [rows]);
  const templateTrials = pairs.data;
  const trials = useMemo(() => (source === 'templates' ? (templateTrials ?? []) : liveTrials), [source, templateTrials, liveTrials]);
  const points = useMemo(() => curve(trials), [trials]);
  const eer = useMemo(() => equalErrorRate(points), [points]);
  const curveSource = source === 'templates' ? `Enrolled template pairs (${trials.length})` : `Live labelled scans (${trials.length})`;

  // Until the user inspects another threshold, the chart reads out the operational Confirmed threshold.
  const selected = picked ?? (payload ? Math.round(payload.match_threshold * 100) / 100 : 0.85);

  const reportInput = useCallback(() => {
    if (!payload) throw new Error('Load scan analytics before exporting.');
    return {
      summary,
      points,
      eer,
      curveSource,
      rows,
      rangeLabel: DATE_RANGES.find((item) => item.key === range)?.label ?? range,
      speciesLabel: species,
      scopeLabel: SCOPE_LABELS[payload.scope],
      matchThreshold: payload.match_threshold,
      reviewThreshold: payload.review_threshold,
      verifyThreshold: payload.verify_threshold,
      preparedBy: session.role ? `${session.name} (${session.role})` : session.name,
      generatedAt: new Date(),
    };
  }, [payload, summary, points, eer, curveSource, rows, range, species, session.name, session.role]);

  const exportPdf = useCallback(async () => {
    setNotice(null);
    setBusy('pdf');
    try {
      const input = reportInput();
      const name = reportFileName(input.generatedAt);
      const outcome = await exportReportPdf(buildReportHtml(input), name);
      setNotice({ tone: 'green', text: outcome === 'downloaded' ? `${name} downloaded.` : outcome === 'shared' ? `${name} is ready in the share sheet.` : `${name} was generated, but sharing is unavailable on this device.` });
      void logAudit('export.records', '', `FRR/FAR analytics PDF: ${input.rows.length} scans`, 'success');
    } catch (caught) {
      console.error('Analytics PDF export failed', caught);
      const text = `PDF report could not be generated. ${messageOf(caught, 'Please try again.')}`;
      setNotice({ tone: 'red', text });
      if (Platform.OS !== 'web') Alert.alert('Report not generated', text);
    } finally {
      setBusy(null);
    }
  }, [reportInput]);

  const exportCsv = useCallback(async () => {
    setNotice(null);
    setBusy('csv');
    try {
      if (rows.length === 0) throw new Error('There are no scans in this range to export.');
      const name = csvFileName(new Date());
      const outcome = await exportCsvFile(buildCsv(rows), name);
      setNotice({ tone: 'green', text: outcome === 'downloaded' ? `${name} downloaded (${rows.length} rows).` : outcome === 'shared' ? `${name} is ready in the share sheet.` : `${name} was saved, but sharing is unavailable on this device.` });
      void logAudit('export.records', '', `Scan telemetry CSV: ${rows.length} rows`, 'success');
    } catch (caught) {
      console.error('Analytics CSV export failed', caught);
      const text = messageOf(caught, 'CSV data could not be exported.');
      setNotice({ tone: 'red', text });
      if (Platform.OS !== 'web') Alert.alert('Export failed', text);
    } finally {
      setBusy(null);
    }
  }, [rows]);

  const { reload } = scans;
  if (!payload && scans.loading) return <LoadingState label="Loading biometric scan analytics…" />;
  if (!payload) return <ErrorState message={scans.error || 'Scan analytics could not be loaded.'} onRetry={() => void reload()} />;

  return (
    <View style={styles.stack}>
      <Card style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="pulse-outline" size={24} color={colors.surface} /></View>
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>FRR / FAR Analytical Report</Text>
          <Text style={styles.heroText}>Error rates from live 1:N and 1:1 scans with verified ground truth. Scope: {SCOPE_LABELS[payload.scope]}.</Text>
        </View>
      </Card>

      <View style={styles.filterBlock}>
        <Text style={styles.filterLabel}>Date range</Text>
        <View style={styles.chips}>
          {DATE_RANGES.map((item) => <OptionChip key={item.key} label={item.label} selected={range === item.key} onPress={() => setRange(item.key)} />)}
        </View>
        <Text style={styles.filterLabel}>Species</Text>
        <View style={styles.chips}>
          {SPECIES_FILTERS.map((item) => <OptionChip key={item} label={item} selected={species === item} onPress={() => setSpecies(item)} tone="blue" />)}
        </View>
      </View>

      <View style={styles.exportRow}>
        <PrimaryButton label={busy === 'pdf' ? 'Generating PDF…' : 'Export PDF Report'} icon="document-text-outline" disabled={!!busy} onPress={() => void exportPdf()} style={styles.exportButton} />
        <PrimaryButton label={busy === 'csv' ? 'Preparing CSV…' : 'Export CSV Data'} icon="download-outline" variant="outline" disabled={!!busy} onPress={() => void exportCsv()} style={styles.exportButton} />
      </View>
      {busy ? <View style={styles.inline}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>{busy === 'pdf' ? 'Generating the executive PDF report…' : 'Preparing scan telemetry…'}</Text></View> : null}
      {notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setNotice(null)} style={[styles.notice, notice.tone === 'red' && styles.noticeError]}>
          <Ionicons name={notice.tone === 'red' ? 'alert-circle' : 'checkmark-circle'} size={18} color={notice.tone === 'red' ? colors.danger : colors.primary} />
          <Text selectable style={[styles.noticeText, notice.tone === 'red' && styles.noticeTextError]}>{notice.text}</Text>
        </Pressable>
      ) : null}
      {scans.loading ? <View style={styles.inline}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Refreshing…</Text></View> : null}
      {scans.error ? <ErrorState message={scans.error} onRetry={() => void reload()} /> : null}

      <Text style={styles.section}>Core error metrics</Text>
      <View style={styles.kpis}>
        <Kpi label="FAR" value={formatRate(summary.far, 3)} note={`${summary.fp} false accepts / ${summary.impostor} impostor trials`} state={benchmark(summary.far, FAR_TARGET)} target="Target < 0.01%" />
        <Kpi label="FRR" value={formatRate(summary.frr)} note={`${summary.fn} false rejects / ${summary.genuine} genuine trials`} state={benchmark(summary.frr, FRR_TARGET)} target="Target < 1.0%" />
        <Kpi label="EER" value={eer ? formatRate(eer.rate) : '—'} note={eer ? `FAR = FRR at ${eer.threshold.toFixed(3)} · ${source === 'live' ? 'live scans' : 'template pairs'}` : 'Needs genuine and impostor trials'} />
        <Kpi label="Accuracy" value={formatRate(summary.accuracy)} note={`${summary.tp + summary.tn} correct of ${summary.genuine + summary.impostor} labelled`} />
        <Kpi label="Precision" value={formatRate(summary.precision)} note="True Match ÷ all accepts" />
        <Kpi label="Recall" value={formatRate(summary.recall)} note="True Match ÷ genuine trials" />
        <Kpi label="F1 Score" value={summary.f1 === null ? '—' : summary.f1.toFixed(3)} note="Precision × recall balance" />
        <Kpi label="Scans" value={String(rows.length)} note={`${summary.genuine + summary.impostor} with verified ground truth`} />
      </View>
      {summary.impostor < trialsNeeded(FAR_TARGET) ? (
        <Text style={styles.muted}>Demonstrating FAR below 0.01% at 95% confidence needs at least {trialsNeeded(FAR_TARGET).toLocaleString()} labelled impostor trials with zero false accepts; this view has {summary.impostor}.</Text>
      ) : null}

      <Card style={styles.matrixCard}>
        <Text style={styles.cardTitle}>Confusion matrix · operational decision</Text>
        <View style={styles.cmGrid}>
          <CmCell label="True Match" value={summary.tp} good />
          <CmCell label="False Reject" value={summary.fn} />
          <CmCell label="False Accept" value={summary.fp} />
          <CmCell label="True Non-Match" value={summary.tn} good />
        </View>
        <Text style={styles.muted}>Accept = Confirmed match (1:N ≥ {payload.match_threshold.toFixed(2)}, 1:1 ≥ {payload.verify_threshold.toFixed(2)}). Review (≥ {payload.review_threshold.toFixed(2)}) and No-match count as rejections.</Text>
      </Card>

      <Text style={styles.section}>Decision threshold matrix</Text>
      <Card style={styles.matrixCard}>
        <View style={styles.chips}>
          <OptionChip label="Live labelled scans" selected={source === 'live'} onPress={() => setSource('live')} />
          <OptionChip label="Enrolled template pairs" selected={source === 'templates'} onPress={() => setSource('templates')} />
        </View>
        <Text style={styles.muted}>{source === 'live' ? 'Curve from scans in the filters above whose ground truth has been verified.' : 'Calibration curve from every genuine / impostor pair of enrolled templates (date and species filters do not apply).'}</Text>
        {source === 'templates' && pairs.loading ? <LoadingState label="Loading enrolled template pairs…" /> : null}
        {source === 'templates' && pairs.error ? <ErrorState message={pairs.error} onRetry={() => void pairs.reload()} /> : null}
        {trials.length === 0 && !(source === 'templates' && pairs.loading) ? (
          <EmptyState title="No labelled trials yet" message={source === 'live' ? 'Verify the ground truth of scans in the audit log below to plot FAR and FRR.' : 'No enrolled templates are available to compare.'} />
        ) : null}
        {trials.length > 0 ? (
          <ThresholdChart points={points} eer={eer} reviewThreshold={payload.review_threshold} matchThreshold={payload.match_threshold} selected={selected} onSelect={setPicked} />
        ) : null}
        {trials.length > 0 ? <MatrixTable points={points} match={payload.match_threshold} review={payload.review_threshold} selected={selected} onSelect={setPicked} /> : null}
      </Card>

      <AuditLog rows={rows} onChanged={reload} />
    </View>
  );
}

function Kpi({ label, value, note, state, target }: { label: string; value: string; note: string; state?: BenchmarkState; target?: string }) {
  return (
    <View style={styles.kpi}>
      <View style={styles.kpiHead}>
        <Text style={styles.kpiLabel}>{label}</Text>
        {state ? <Pill label={state === 'pass' ? 'Meets target' : state === 'fail' ? 'Above target' : 'No data'} tone={state === 'pass' ? 'green' : state === 'fail' ? 'red' : 'slate'} /> : null}
      </View>
      <Text selectable style={styles.kpiValue}>{value}</Text>
      {target ? <Text style={styles.kpiTarget}>{target}</Text> : null}
      <Text style={styles.kpiNote}>{note}</Text>
    </View>
  );
}

function CmCell({ label, value, good = false }: { label: string; value: number; good?: boolean }) {
  return (
    <View style={[styles.cmCell, good ? styles.cmGood : styles.cmBad]}>
      <Ionicons name={good ? 'checkmark-circle' : 'close-circle'} size={16} color={good ? colors.primaryDark : colors.danger} />
      <Text style={styles.cmLabel}>{label}</Text>
      <Text selectable style={styles.cmValue}>{value}</Text>
    </View>
  );
}

function MatrixTable({ points, match, review, selected, onSelect }: { points: ReturnType<typeof curve>; match: number; review: number; selected: number; onSelect: (t: number) => void }) {
  const shown = points.filter((p) => Math.round(p.threshold * 100) % 5 === 0);
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.thRow]}>
        <Text style={[styles.th, styles.colT]}>Threshold</Text>
        <Text style={styles.th}>FAR</Text>
        <Text style={styles.th}>FRR</Text>
        <Text style={styles.th}>FA / FR</Text>
      </View>
      {shown.map((p) => {
        const tag = Math.abs(p.threshold - match) < 0.001 ? 'Confirmed' : Math.abs(p.threshold - review) < 0.001 ? 'Review' : '';
        const active = Math.abs(p.threshold - selected) < 0.001;
        return (
          <Pressable key={p.threshold} accessibilityRole="button" accessibilityLabel={`Threshold ${p.threshold.toFixed(2)}`} onPress={() => onSelect(p.threshold)} style={[styles.tr, tag && styles.trOp, active && styles.trActive]}>
            <Text style={[styles.td, styles.colT, styles.tdStrong]}>{p.threshold.toFixed(2)}{tag ? ` · ${tag}` : ''}</Text>
            <Text style={styles.td}>{formatRate(p.far, 3)}</Text>
            <Text style={styles.td}>{formatRate(p.frr)}</Text>
            <Text style={styles.td}>{p.falseAccepts} / {p.falseRejects}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AuditLog({ rows, onChanged }: { rows: ScanAnalyticsRow[]; onChanged: () => Promise<void> }) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const visible = useMemo(() => {
    if (filter === 'unlabelled') return rows.filter((row) => !row.ground_truth);
    if (filter === 'errors') return rows.filter((row) => verdictOf(row).startsWith('False'));
    return rows;
  }, [filter, rows]);

  const label = useCallback(async (row: ScanAnalyticsRow, truth: GroundTruth | null) => {
    setError('');
    setPending(row.id);
    try {
      const { error: rpcError } = await supabase.rpc('label_scan_ground_truth', { p_scan: row.id, p_truth: truth, p_note: '' });
      if (rpcError) throw rpcError;
      await onChanged();
    } catch (caught) {
      console.error('Ground truth label failed', caught);
      if (mounted.current) setError(messageOf(caught, 'The ground truth could not be saved.'));
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [onChanged]);

  return (
    <>
      <Text style={styles.section}>Live biometric scan audit log</Text>
      <View style={styles.chips}>
        <OptionChip label={`All (${rows.length})`} selected={filter === 'all'} onPress={() => setFilter('all')} />
        <OptionChip label={`Unlabelled (${rows.filter((row) => !row.ground_truth).length})`} selected={filter === 'unlabelled'} onPress={() => setFilter('unlabelled')} />
        <OptionChip label="Errors only" selected={filter === 'errors'} onPress={() => setFilter('errors')} tone="red" />
      </View>
      <Text style={styles.muted}>Confirm what really happened for each scan. Only verified scans count toward FAR and FRR.</Text>
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      {visible.length === 0 ? <EmptyState title="No scans" message="No biometric scans match these filters. Run Identify or Verify to record live scans." /> : null}
      {visible.slice(0, limit).map((row) => <ScanCard key={row.id} row={row} busy={pending === row.id} disabled={!!pending} onLabel={label} />)}
      {visible.length > limit ? <PrimaryButton label={`Show more (${visible.length - limit} remaining)`} variant="outline" onPress={() => setLimit((value) => value + PAGE)} /> : null}
    </>
  );
}

const ScanCard = memo(function ScanCard({ row, busy, disabled, onLabel }: { row: ScanAnalyticsRow; busy: boolean; disabled: boolean; onLabel: (row: ScanAnalyticsRow, truth: GroundTruth | null) => Promise<void> }) {
  const verdict = verdictOf(row);
  const choices = verdictChoices(row);
  const outcomeLabel = row.outcome === 'match' ? 'Confirmed' : row.outcome === 'uncertain' ? 'Review' : 'No match';
  return (
    <Card style={styles.scanCard}>
      <View style={styles.scanHead}>
        <View style={styles.flex}>
          <Text selectable style={styles.scanId}>{row.moozzle_id ?? 'No linked animal'}</Text>
          <Text style={styles.scanMeta}>{formatTimestamp(row.created_at)} · {SCAN_TYPE_LABELS[row.scan_type]}{row.species ? ` · ${row.species}` : ''}</Text>
        </View>
        <View style={styles.badge}><Pill label={verdict} tone={VERDICT_TONE[verdict]} /></View>
      </View>
      <View style={styles.scanStats}>
        <Stat label="Similarity" value={formatScore(row.similarity)} />
        <Stat label="Outcome" value={outcomeLabel} />
        <Stat label="Quality" value={formatScore(row.quality_score)} />
        <Stat label="Time" value={row.processing_ms === null ? '—' : `${(row.processing_ms / 1000).toFixed(1)} s`} />
      </View>
      <View style={styles.labelRow}>
        {busy ? <ActivityIndicator color={colors.primary} /> : null}
        {choices.map((choice) => {
          const active = verdict === choice;
          return (
            <Pressable
              key={choice}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`Mark as ${choice}`}
              disabled={disabled}
              onPress={() => void onLabel(row, active ? null : truthForVerdict(choice))}
              style={[styles.labelButton, active && (choice.startsWith('False') ? styles.labelBad : styles.labelGood), disabled && styles.labelDisabled]}
            >
              <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={active ? colors.surface : colors.muted} />
              <Text style={[styles.labelText, active && styles.labelTextActive]}>{choice}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text selectable style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#064E3B', borderColor: '#064E3B' },
  heroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 18 },
  heroText: { color: 'rgba(255,255,255,0.85)', fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  filterBlock: { gap: 6 },
  filterLabel: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  exportButton: { flexGrow: 1, flexBasis: 200 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12, minHeight: 44 },
  noticeError: { backgroundColor: colors.dangerLight },
  noticeText: { flex: 1, color: colors.primaryDark, fontFamily: Fonts.medium, fontSize: 13 },
  noticeTextError: { color: colors.danger },
  section: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 8 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { flexGrow: 1, flexBasis: 150, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 3, boxShadow: '0 2px 10px rgba(15, 23, 42, 0.05)' },
  kpiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
  kpiLabel: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.6 },
  kpiValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24, fontVariant: ['tabular-nums'] },
  kpiTarget: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 11 },
  kpiNote: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 15 },
  matrixCard: { gap: 10 },
  cardTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  cmGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cmCell: { flexGrow: 1, flexBasis: '45%', borderRadius: 12, padding: 10, gap: 2 },
  cmGood: { backgroundColor: colors.primaryLight },
  cmBad: { backgroundColor: colors.dangerLight },
  cmLabel: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  cmValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 22, fontVariant: ['tabular-nums'] },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  thRow: { backgroundColor: colors.primaryLight, minHeight: 34 },
  trOp: { backgroundColor: '#FEF9C3' },
  trActive: { borderLeftWidth: 3, borderLeftColor: colors.text },
  th: { flex: 1, color: colors.primaryDark, fontFamily: Fonts.bold, fontSize: 11 },
  td: { flex: 1, color: colors.text, fontFamily: Fonts.regular, fontSize: 12, fontVariant: ['tabular-nums'] },
  tdStrong: { fontFamily: Fonts.semiBold },
  colT: { flex: 1.5 },
  scanCard: { gap: 10 },
  scanHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  scanId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  scanMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
  badge: { flexShrink: 1, maxWidth: '45%' },
  scanStats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.slateLight, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  statLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, fontVariant: ['tabular-nums'] },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  labelButton: { flexGrow: 1, flexBasis: 130, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 10 },
  labelGood: { backgroundColor: colors.primary, borderColor: colors.primary },
  labelBad: { backgroundColor: colors.danger, borderColor: colors.danger },
  labelDisabled: { opacity: 0.6 },
  labelText: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  labelTextActive: { color: colors.surface },
});
