import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { Card, colors, DataGate, EmptyState, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { shareExport, toCsv } from '@/lib/export';
import { allows } from '@/lib/rbac';
import { messageOf, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item) || '—', (map.get(key(item) || '—') ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export default function ReportsScreen() {
  return (
    <DataGate>
      <StackScreen title="Reports & Analytics" eyebrow="Scoped to your role" destination="reports">
        <ReportsContent />
      </StackScreen>
    </DataGate>
  );
}

function ReportsContent() {
  const session = useSession();
  const role = session.role;
  const { animals, records } = useBovineData();
  const policies = useBovineStore((state) => state.policyRows);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const own = session.permissions.view_reports === 'Own';
  const scopedRecords = useMemo(() => (own && role !== 'Farmer' ? records.filter((record) => record.author_id === session.userId) : records), [own, records, role, session.userId]);
  const visibleAnimals = useMemo(() => animals.filter((animal) => animal.approval_status !== 'Draft'), [animals]);
  const exportLevel = session.permissions.export_records;
  const canExport = allows(exportLevel);
  const identifiable = exportLevel === 'Authorised' || exportLevel === 'Scoped' || exportLevel === 'Own';

  const sections = useMemo(() => {
    const result: { title: string; rows: [string, number][] }[] = [];
    if (role === 'Insurance Officer') {
      result.push({ title: 'Verification results', rows: countBy(policies, (p) => p.verification_status) });
      result.push({ title: 'Claim status', rows: countBy(policies, (p) => p.claim_status) });
      return result;
    }
    result.push({ title: 'Animals by species', rows: countBy(visibleAnimals, (a) => a.animal_type) });
    result.push({ title: 'Breed coverage', rows: countBy(visibleAnimals, (a) => a.breed) });
    if (role === 'Government Officer' || role === 'Livestock Inspector' || role === 'Organisation Administrator' || role === 'Super Administrator') {
      result.push({ title: 'Village coverage', rows: countBy(visibleAnimals, (a) => `${a.village}, ${a.district}`) });
    }
    if (role === 'Farm Manager' || role === 'Organisation Administrator') result.push({ title: 'Animals by farm', rows: countBy(visibleAnimals, (a) => a.farm_name) });
    result.push({ title: own && role !== 'Farmer' ? 'Services recorded by you' : 'Services in scope', rows: countBy(scopedRecords, (r) => r.record_type) });
    result.push({ title: 'Registration lifecycle', rows: countBy(animals, (a) => a.approval_status) });
    return result;
  }, [animals, own, policies, role, scopedRecords, visibleAnimals]);

  const exportAnimals = useCallback(async () => {
    setError('');
    setMessage('');
    try {
      // De-identified or limited exports omit owner details and exact location.
      const headers = identifiable ? ['moozzle_id', 'species', 'breed', 'sex', 'age_years', 'age_months', 'farm', 'village', 'district', 'status', 'approval', 'owner'] : ['moozzle_id', 'species', 'breed', 'sex', 'age_years', 'age_months', 'district', 'status'];
      const rows = visibleAnimals.map((a) => (identifiable ? [a.moozzle_id, a.animal_type, a.breed, a.sex, a.age_years, a.age_months, a.farm_name, a.village, a.district, a.current_status, a.approval_status, a.owner_visible ? a.owner_name : ''] : [a.moozzle_id, a.animal_type, a.breed, a.sex, a.age_years, a.age_months, a.district, a.current_status]));
      const outcome = await shareExport('MOOZZLE animal register', toCsv(headers, rows), rows.length);
      setMessage(outcome === 'copied' ? `${rows.length} rows copied as CSV. Export recorded in the audit trail.` : 'Export shared and recorded in the audit trail.');
    } catch (caught) {
      console.error('Export failed', caught);
      setError(messageOf(caught, 'The export could not be created.'));
    }
  }, [identifiable, visibleAnimals]);

  const exportServices = useCallback(async () => {
    setError('');
    setMessage('');
    try {
      const rows = scopedRecords.map((r) => [r.date, r.service_type, r.record_type, animals.find((a) => a.id === r.animal_id)?.moozzle_id ?? '', r.performer_role, identifiable ? r.performed_by : '']);
      const outcome = await shareExport('MOOZZLE service records', toCsv(['date', 'type', 'title', 'moozzle_id', 'performer_role', 'performer'], rows), rows.length);
      setMessage(outcome === 'copied' ? `${rows.length} rows copied as CSV. Export recorded in the audit trail.` : 'Export shared and recorded in the audit trail.');
    } catch (caught) {
      console.error('Export failed', caught);
      setError(messageOf(caught, 'The export could not be created.'));
    }
  }, [animals, identifiable, scopedRecords]);

  if (role === 'API Administrator') {
    return <EmptyState title="Technical reports only" message="Integration metrics are on the API Clients screen." />;
  }

  return (
    <>
      <Text style={styles.muted}>Figures are computed from records the server returned for your role ({session.scopeLabel}).</Text>
      {sections.map((section) => {
        const max = Math.max(1, ...section.rows.map(([, value]) => value));
        return (
          <Card key={section.title} style={styles.card}>
            <Text style={styles.title}>{section.title}</Text>
            {section.rows.length === 0 ? <Text style={styles.muted}>No data yet.</Text> : null}
            {section.rows.slice(0, 8).map(([label, value]) => (
              <View key={label} style={styles.barRow}>
                <Text numberOfLines={1} style={styles.barLabel}>{label}</Text>
                <View style={styles.track}><View style={[styles.fill, { width: `${(value / max) * 100}%` }]} /></View>
                <Text style={styles.barValue}>{value}</Text>
              </View>
            ))}
          </Card>
        );
      })}
      <Card style={styles.card}>
        <Text style={styles.title}>Export</Text>
        <Text style={styles.muted}>Your export permission: {exportLevel}. {identifiable ? 'Exports include identifiable fields within your scope.' : 'Exports exclude owner and exact location fields.'} Every export is logged.</Text>
        <PrimaryButton label="Export Animal Register (CSV)" icon="download-outline" onPress={() => void exportAnimals()} disabled={!canExport || visibleAnimals.length === 0} />
        <PrimaryButton label="Export Service Records (CSV)" icon="download-outline" variant="outline" onPress={() => void exportServices()} disabled={!canExport || scopedRecords.length === 0} />
        {!canExport ? <Text style={styles.muted}>Your role is not permitted to export records.</Text> : null}
        {message ? <Text selectable style={styles.ok}>{message}</Text> : null}
        {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  card: { gap: 10 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 130, color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.slateLight, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
  barValue: { width: 34, textAlign: 'right', color: colors.text, fontFamily: Fonts.bold, fontSize: 13, fontVariant: ['tabular-nums'] },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
});
