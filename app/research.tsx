import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { Card, colors, DataGate, EmptyState, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import type { ResearchRow } from '@/lib/dashboard';
import { shareExport, toCsv } from '@/lib/export';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { messageOf } from '@/store/useBovineStore';

export default function ResearchScreen() {
  return (
    <DataGate>
      <StackScreen title="Approved Dataset" eyebrow="De-identified research data" destination="research">
        <ResearchContent />
      </StackScreen>
    </DataGate>
  );
}

function ResearchContent() {
  const [notice, setNotice] = useState('');
  const [exportError, setExportError] = useState('');
  const fetchRows = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('research_dataset');
    if (rpcError) throw rpcError;
    return ((data ?? []) as ResearchRow[]).map((row) => ({ ...row, quality_score: Number(row.quality_score) }));
  }, []);
  const { data: rows, error, reload } = useAsyncResource(fetchRows, 'The dataset could not be loaded.');

  const breeds = useMemo(() => {
    const map = new Map<string, { n: number; q: number }>();
    for (const row of rows ?? []) {
      const entry = map.get(row.breed) ?? { n: 0, q: 0 };
      map.set(row.breed, { n: entry.n + 1, q: entry.q + row.quality_score });
    }
    return [...map.entries()].map(([breed, value]) => ({ breed, n: value.n, avg: value.q / value.n })).sort((a, b) => b.n - a.n);
  }, [rows]);
  const buckets = useMemo(() => {
    const list = rows ?? [];
    return [
      { label: '≥ 0.90', n: list.filter((r) => r.quality_score >= 0.9).length },
      { label: '0.80–0.89', n: list.filter((r) => r.quality_score >= 0.8 && r.quality_score < 0.9).length },
      { label: '0.70–0.79', n: list.filter((r) => r.quality_score >= 0.7 && r.quality_score < 0.8).length },
      { label: '< 0.70', n: list.filter((r) => r.quality_score < 0.7).length },
    ];
  }, [rows]);

  const exportRows = useCallback(async () => {
    if (!rows) return;
    setNotice('');
    setExportError('');
    try {
      const csv = toCsv(['subject', 'species', 'breed', 'sex', 'age_years', 'state', 'quality_score', 'captures', 'model_version', 'enrolled_month'], rows.map((r) => [r.subject, r.species, r.breed, r.sex, r.age_years, r.state, r.quality_score, r.captures, r.model_version, r.enrolled_month]));
      const outcome = await shareExport('MOOZZLE de-identified dataset', csv, rows.length);
      setNotice(outcome === 'copied' ? `${rows.length} de-identified rows copied. Export audited.` : 'Dataset shared. Export audited.');
    } catch (caught) {
      console.error('Dataset export failed', caught);
      setExportError(messageOf(caught, 'The dataset could not be exported.'));
    }
  }, [rows]);

  const max = Math.max(1, ...buckets.map((bucket) => bucket.n));

  return (
    <>
      <Text style={styles.muted}>Subjects are pseudonymous hashes. MOOZZLE IDs, owners, farms, villages and biometric templates are never included. Use for approved research purposes only.</Text>
      {error ? <View style={styles.gap}><Text selectable style={styles.error}>{error}</Text><PrimaryButton label="Retry" variant="outline" onPress={() => void reload()} /></View> : null}
      {!rows && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {rows && rows.length === 0 ? <EmptyState title="Dataset is empty" message="Approved registrations appear here in de-identified form." /> : null}
      {rows && rows.length > 0 ? (
        <>
          <Card style={styles.card}>
            <Text style={styles.title}>Image quality distribution</Text>
            {buckets.map((bucket) => (
              <View key={bucket.label} style={styles.barRow}>
                <Text style={styles.barLabel}>{bucket.label}</Text>
                <View style={styles.track}><View style={[styles.fill, { width: `${(bucket.n / max) * 100}%` }]} /></View>
                <Text style={styles.barValue}>{bucket.n}</Text>
              </View>
            ))}
          </Card>
          <Card style={styles.card}>
            <Text style={styles.title}>Breed analysis</Text>
            {breeds.map((item) => (
              <View key={item.breed} style={styles.breedRow}>
                <Text style={styles.breed}>{item.breed}</Text>
                <Text style={styles.breedMeta}>{item.n} subjects · mean quality {item.avg.toFixed(2)}</Text>
              </View>
            ))}
          </Card>
          <Card style={styles.card}>
            <Text style={styles.title}>Subjects ({rows.length})</Text>
            {rows.slice(0, 30).map((row) => (
              <Text key={row.subject} selectable style={styles.subject}>{row.subject} · {row.species} · {row.breed} · {row.sex} · {row.age_years}y · {row.state} · q {row.quality_score.toFixed(2)} · {row.enrolled_month}</Text>
            ))}
          </Card>
          <PrimaryButton label="Export De-identified CSV" icon="download-outline" onPress={() => void exportRows()} />
          {notice ? <Text selectable style={styles.ok}>{notice}</Text> : null}
          {exportError ? <Text selectable style={styles.error}>{exportError}</Text> : null}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  card: { gap: 10 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 80, color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.slateLight, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: '#7C3AED' },
  barValue: { width: 30, textAlign: 'right', color: colors.text, fontFamily: Fonts.bold, fontSize: 13 },
  breedRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  breed: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  breedMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  subject: { color: colors.text, fontFamily: Fonts.regular, fontSize: 12 },
});
