import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { Card, colors, EmptyState, OptionChip, Pill, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { exportCsvFile, exportReportPdf } from '@/lib/analytics/export';
import { curve, equalErrorRate, formatScore, formatTimestamp, SCAN_TYPE_LABELS, summarise, trialsFromScans, truthForVerdict, verdictChoices, verdictOf } from '@/lib/analytics/metrics';
import { buildCsv, buildReportHtml, csvFileName, reportFileName } from '@/lib/analytics/report';
import { supabase } from '@/lib/supabase';
import { logAudit, messageOf, useSession } from '@/store/useBovineStore';
import type { GroundTruth, ScanAnalyticsPayload, ScanAnalyticsRow, ScanVerdict } from '@/store/types';

const PAGE = 20;

const isLabelled = (row: ScanAnalyticsRow) => (row.scan_type === 'identify' ? row.mated !== null : !!row.ground_truth);
type LogFilter = 'all' | 'unlabelled' | 'verify' | 'identify';

const VERDICT_TONE: Record<ScanVerdict, 'green' | 'red' | 'slate'> = {
  'True Match': 'green',
  'True Non-Match': 'green',
  'False Accept': 'red',
  'False Reject': 'red',
  Unlabelled: 'slate',
};

const SCOPE_LABELS: Record<ScanAnalyticsPayload['scope'], string> = {
  own: 'Your scans',
  organisation: 'Your organisation',
  platform: 'Whole platform',
};

/** Ground-truth labelling of controlled trials, plus the 1:1 verification report and raw CSV export. */
export function ScanLabelling({ payload, rows, tierLabel, rangeLabel, onChanged }: { payload: ScanAnalyticsPayload; rows: ScanAnalyticsRow[]; tierLabel: string; rangeLabel: string; onChanged: () => Promise<void> }) {
  const session = useSession();
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);

  // The PDF report is 1:1 verification only: FAR / FRR are never computed from 1:N searches.
  const verifyRows = useMemo(() => rows.filter((r) => r.scan_type === 'verify'), [rows]);

  const exportPdf = useCallback(async () => {
    setNotice(null);
    setBusy('pdf');
    try {
      const trials = trialsFromScans(verifyRows);
      const points = curve(trials);
      const generatedAt = new Date();
      const name = reportFileName(generatedAt);
      const outcome = await exportReportPdf(buildReportHtml({
        summary: summarise(verifyRows),
        points,
        eer: equalErrorRate(points),
        curveSource: `Labelled 1:1 verification trials (${trials.length}) · ${tierLabel}`,
        rows: verifyRows,
        rangeLabel,
        speciesLabel: 'Current filters',
        scopeLabel: SCOPE_LABELS[payload.scope],
        matchThreshold: payload.config.identify_accept,
        reviewThreshold: payload.config.verify_review,
        verifyThreshold: payload.config.verify_accept,
        preparedBy: session.role ? `${session.name} (${session.role})` : session.name,
        generatedAt,
      }), name);
      setNotice({ tone: 'green', text: outcome === 'downloaded' ? `${name} downloaded.` : outcome === 'shared' ? `${name} is ready in the share sheet.` : `${name} was generated, but sharing is unavailable on this device.` });
      void logAudit('export.records', '', `1:1 FAR/FRR PDF: ${verifyRows.length} scans · ${tierLabel}`, 'success');
    } catch (caught) {
      console.error('Analytics PDF export failed', caught);
      const text = `PDF report could not be generated. ${messageOf(caught, 'Please try again.')}`;
      setNotice({ tone: 'red', text });
      if (Platform.OS !== 'web') Alert.alert('Report not generated', text);
    } finally {
      setBusy(null);
    }
  }, [payload, rangeLabel, session.name, session.role, tierLabel, verifyRows]);

  const exportCsv = useCallback(async () => {
    setNotice(null);
    setBusy('csv');
    try {
      if (rows.length === 0) throw new Error('There are no scans for these filters to export.');
      const name = csvFileName(new Date());
      const outcome = await exportCsvFile(buildCsv(rows), name);
      setNotice({ tone: 'green', text: outcome === 'downloaded' ? `${name} downloaded (${rows.length} rows).` : outcome === 'shared' ? `${name} is ready in the share sheet.` : `${name} was saved, but sharing is unavailable on this device.` });
      void logAudit('export.records', '', `Scan telemetry CSV: ${rows.length} rows · ${tierLabel}`, 'success');
    } catch (caught) {
      console.error('Analytics CSV export failed', caught);
      const text = messageOf(caught, 'CSV data could not be exported.');
      setNotice({ tone: 'red', text });
      if (Platform.OS !== 'web') Alert.alert('Export failed', text);
    } finally {
      setBusy(null);
    }
  }, [rows, tierLabel]);

  return (
    <View style={styles.stack}>
      <View style={styles.exportRow}>
        <PrimaryButton label={busy === 'pdf' ? 'Generating PDF…' : 'Export 1:1 FAR/FRR PDF'} icon="document-text-outline" disabled={!!busy} onPress={() => void exportPdf()} style={styles.exportButton} />
        <PrimaryButton label={busy === 'csv' ? 'Preparing CSV…' : 'Export CSV Data'} icon="download-outline" variant="outline" disabled={!!busy} onPress={() => void exportCsv()} style={styles.exportButton} />
      </View>
      {busy ? <View style={styles.inline}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>{busy === 'pdf' ? 'Generating the 1:1 verification report…' : 'Preparing scan telemetry…'}</Text></View> : null}
      {notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setNotice(null)} style={[styles.notice, notice.tone === 'red' && styles.noticeError]}>
          <Ionicons name={notice.tone === 'red' ? 'alert-circle' : 'checkmark-circle'} size={18} color={notice.tone === 'red' ? colors.danger : colors.primary} />
          <Text selectable style={[styles.noticeText, notice.tone === 'red' && styles.noticeTextError]}>{notice.text}</Text>
        </Pressable>
      ) : null}
      <LabelLog rows={rows} onChanged={onChanged} />
    </View>
  );
}

function LabelLog({ rows, onChanged }: { rows: ScanAnalyticsRow[]; onChanged: () => Promise<void> }) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const visible = useMemo(() => {
    if (filter === 'unlabelled') return rows.filter((row) => row.scan_type !== 'enrol_check' && !isLabelled(row));
    if (filter === 'verify' || filter === 'identify') return rows.filter((row) => row.scan_type === filter);
    return rows;
  }, [filter, rows]);

  const run = useCallback(async (row: ScanAnalyticsRow, call: () => PromiseLike<{ error: unknown }>) => {
    setError('');
    setPending(row.id);
    try {
      const { error: rpcError } = await call();
      if (rpcError) throw rpcError;
      await onChanged();
    } catch (caught) {
      console.error('Ground truth label failed', caught);
      if (mounted.current) setError(messageOf(caught, 'The label could not be saved.'));
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [onChanged]);

  const labelVerify = useCallback((row: ScanAnalyticsRow, truth: GroundTruth | null) => run(row, () => supabase.rpc('label_scan_ground_truth', { p_scan: row.id, p_truth: truth, p_note: '' })), [run]);
  const labelIdentify = useCallback((row: ScanAnalyticsRow, mated: boolean | null, trueId: string) => run(row, () => supabase.rpc('label_identification_truth', { p_scan: row.id, p_mated: mated, p_true_moozzle_id: trueId, p_note: '' })), [run]);

  return (
    <>
      <Text style={styles.section}>Ground-truth labels</Text>
      <View style={styles.chips}>
        <OptionChip label={`All (${rows.length})`} selected={filter === 'all'} onPress={() => setFilter('all')} />
        <OptionChip label="Unlabelled" selected={filter === 'unlabelled'} onPress={() => setFilter('unlabelled')} />
        <OptionChip label="1:1 only" selected={filter === 'verify'} onPress={() => setFilter('verify')} tone="blue" />
        <OptionChip label="1:N only" selected={filter === 'identify'} onPress={() => setFilter('identify')} tone="blue" />
      </View>
      <Text style={styles.muted}>1:1 scans are labelled genuine (the claimed animal) or impostor. 1:N searches are labelled mated (enrolled — give the true MOOZZLE ID) or non-mated. Only session owners and authorised research / administration roles can label; field users cannot label their own scans.</Text>
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      {visible.length === 0 ? <EmptyState title="No scans" message="No biometric scans match these filters." /> : null}
      {visible.slice(0, limit).map((row) => <ScanCard key={row.id} row={row} busy={pending === row.id} disabled={!!pending} onVerify={labelVerify} onIdentify={labelIdentify} />)}
      {visible.length > limit ? <PrimaryButton label={`Show more (${visible.length - limit} remaining)`} variant="outline" onPress={() => setLimit((value) => value + PAGE)} /> : null}
    </>
  );
}

interface ScanCardProps {
  row: ScanAnalyticsRow;
  busy: boolean;
  disabled: boolean;
  onVerify: (row: ScanAnalyticsRow, truth: GroundTruth | null) => Promise<void>;
  onIdentify: (row: ScanAnalyticsRow, mated: boolean | null, trueId: string) => Promise<void>;
}

const ScanCard = memo(function ScanCard({ row, busy, disabled, onVerify, onIdentify }: ScanCardProps) {
  const [trueId, setTrueId] = useState('');
  const outcomeLabel = row.outcome === 'match' ? 'Confirmed' : row.outcome === 'uncertain' ? 'Review' : 'No match';
  const verdict = row.scan_type === 'verify' ? verdictOf(row) : null;
  const idLabel = row.scan_type === 'identify' ? (row.mated === null ? 'Unlabelled' : row.mated ? `Mated · rank ${row.mate_rank ?? 'not in list'}` : 'Non-mated') : null;
  return (
    <Card style={styles.scanCard}>
      <View style={styles.scanHead}>
        <View style={styles.flex}>
          <Text selectable style={styles.scanId}>{row.moozzle_id ?? (row.scan_type === 'identify' ? 'No candidate in scope' : 'De-identified')}</Text>
          <Text style={styles.scanMeta}>{formatTimestamp(row.created_at)} · {SCAN_TYPE_LABELS[row.scan_type]} · cfg v{row.config_version ?? '—'}{row.species ? ` · ${row.species}` : ''}</Text>
        </View>
        <View style={styles.badge}>{verdict ? <Pill label={verdict} tone={VERDICT_TONE[verdict]} /> : idLabel ? <Pill label={idLabel} tone={row.mated === null ? 'slate' : 'blue'} /> : <Pill label="Enrolment check" tone="slate" />}</View>
      </View>
      <View style={styles.scanStats}>
        <Stat label="Top score" value={formatScore(row.similarity)} />
        <Stat label="Outcome" value={outcomeLabel} />
        <Stat label="Quality" value={formatScore(row.quality_score)} />
        <Stat label="Device" value={row.device_model || '—'} />
      </View>
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {row.can_label && row.scan_type === 'verify' ? (
        <View style={styles.labelRow}>
          {verdictChoices(row).map((choice) => {
            const active = verdict === choice;
            return (
              <Pressable key={choice} accessibilityRole="button" accessibilityState={{ selected: active, disabled }} accessibilityLabel={`Mark as ${choice}`} disabled={disabled} onPress={() => void onVerify(row, active ? null : truthForVerdict(choice))} style={[styles.labelButton, active && (choice.startsWith('False') ? styles.labelBad : styles.labelGood), disabled && styles.labelDisabled]}>
                <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={active ? colors.surface : colors.muted} />
                <Text style={[styles.labelText, active && styles.labelTextActive]}>{choice}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {row.can_label && row.scan_type === 'identify' ? (
        <View style={styles.idLabel}>
          <TextField label="True MOOZZLE ID (mated search)" value={trueId} onChangeText={(v) => setTrueId(v.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" placeholder="12 digits" />
          <View style={styles.labelRow}>
            <PrimaryButton label="Mated" icon="checkmark-circle-outline" variant="blue" onPress={() => void onIdentify(row, true, trueId)} disabled={disabled || trueId.length !== 12} style={styles.labelAction} />
            <PrimaryButton label="Non-mated" icon="remove-circle-outline" variant="outline" onPress={() => void onIdentify(row, false, '')} disabled={disabled} style={styles.labelAction} />
            {row.mated !== null ? <PrimaryButton label="Clear" variant="soft" onPress={() => void onIdentify(row, null, '')} disabled={disabled} style={styles.labelAction} /> : null}
          </View>
        </View>
      ) : null}
      {!row.can_label && row.scan_type !== 'enrol_check' ? <Text style={styles.muted}>You are not authorised to label this scan.</Text> : null}
    </Card>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text selectable numberOfLines={1} style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
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
  scanCard: { gap: 10 },
  scanHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  scanId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  scanMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
  badge: { flexShrink: 1, maxWidth: '45%' },
  scanStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, flexBasis: 70, backgroundColor: colors.slateLight, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  statLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, fontVariant: ['tabular-nums'] },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  labelButton: { flexGrow: 1, flexBasis: 130, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 10 },
  labelGood: { backgroundColor: colors.primary, borderColor: colors.primary },
  labelBad: { backgroundColor: colors.danger, borderColor: colors.danger },
  labelDisabled: { opacity: 0.6 },
  labelText: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  labelTextActive: { color: colors.surface },
  idLabel: { gap: 8 },
  labelAction: { flexGrow: 1, flexBasis: 110, minHeight: 44 },
});
