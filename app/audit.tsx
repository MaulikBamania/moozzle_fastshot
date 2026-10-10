import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { Card, colors, DataGate, EmptyState, OptionChip, Pill, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useSession } from '@/store/useBovineStore';
import type { AuditRow } from '@/store/types';

type Category = 'all' | 'auth' | 'biometric' | 'record' | 'admin' | 'api' | 'denied';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'auth', label: 'Sign-in & roles' },
  { key: 'biometric', label: 'Biometric' },
  { key: 'record', label: 'Records' },
  { key: 'admin', label: 'Admin' },
  { key: 'api', label: 'API & sync' },
  { key: 'denied', label: 'Denied' },
];

function matches(row: AuditRow, category: Category): boolean {
  switch (category) {
    case 'auth':
      return row.action.startsWith('auth.') || row.action.startsWith('security.');
    case 'biometric':
      return row.action.startsWith('biometric.');
    case 'record':
      return /^(animal|service|record|request|export)\./.test(row.action);
    case 'admin':
      return row.action.startsWith('admin.');
    case 'api':
      return row.action.startsWith('api.') || row.action.startsWith('sync.');
    case 'denied':
      return row.outcome === 'denied';
    default:
      return true;
  }
}

export default function AuditScreen() {
  return (
    <DataGate>
      <StackScreen title="Audit Logs" eyebrow="Immutable trail" destination="audit">
        <AuditContent />
      </StackScreen>
    </DataGate>
  );
}

function AuditContent() {
  const session = useSession();
  const level = session.permissions.view_audit_logs;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const fetchRows = useCallback(async () => {
    // Row-level security limits this to the active role's audit scope.
    const { data, error: queryError } = await supabase.from('audit_logs').select('id, event_id, user_id, user_role, action, target_moozzle_id, details, outcome, reason, source, created_at').order('created_at', { ascending: false }).limit(300);
    if (queryError) throw queryError;
    return (data ?? []) as AuditRow[];
  }, []);
  const { data: rows, error, reload } = useAsyncResource(fetchRows, 'Audit logs could not be loaded.');

  const filtered = useMemo(() => {
    const q = query.replace(/\s/g, '').toLowerCase();
    return (rows ?? []).filter((row) => matches(row, category) && (!q || [row.action, row.target_moozzle_id, row.details, row.user_role, row.event_id].some((value) => value.replace(/\s/g, '').toLowerCase().includes(q))));
  }, [category, query, rows]);

  const scopeText = level === 'Full' ? 'All platform events' : level === 'Scoped' ? `Events in ${session.organisation?.name ?? 'your organisation'}` : level === 'Technical only' ? 'Technical events (API, sync) and your own activity' : 'Your own activity';

  return (
    <>
      <Card style={styles.scope}>
        <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
        <View style={styles.flex}>
          <Text style={styles.scopeTitle}>{scopeText}</Text>
          <Text style={styles.scopeText}>Audit records are written by the server and cannot be edited or deleted. Passwords, secrets and biometric templates are never logged.</Text>
        </View>
      </Card>
      <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Action, MOOZZLE ID, role or event ID" autoCapitalize="none" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
        {CATEGORIES.map((item) => <OptionChip key={item.key} label={item.label} selected={category === item.key} onPress={() => setCategory(item.key)} />)}
      </ScrollView>
      {error ? (
        <View style={styles.errorBox}>
          <Text selectable style={styles.error}>{error}</Text>
          <PrimaryButton label="Retry" variant="outline" onPress={() => void reload()} />
        </View>
      ) : null}
      {!rows && !error ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}
      {rows && filtered.length === 0 ? <EmptyState title="No audit events" message="No events match this filter in your audit scope." /> : null}
      {filtered.map((row) => (
        <Card key={row.id} style={styles.row}>
          <View style={styles.rowTop}>
            <Text style={styles.action}>{row.action}</Text>
            <Pill label={row.outcome} tone={row.outcome === 'success' ? 'green' : row.outcome === 'denied' ? 'red' : row.outcome === 'requested' ? 'blue' : 'amber'} />
          </View>
          <Text selectable style={styles.meta}>{new Date(row.created_at).toLocaleString()} · {row.user_role || 'anonymous'} · {row.event_id}</Text>
          {row.target_moozzle_id ? <Text selectable style={styles.target}>Target MOOZZLE ID {row.target_moozzle_id.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}</Text> : null}
          {row.details ? <Text selectable style={styles.details}>{row.details}</Text> : null}
          {row.reason ? <Text selectable style={styles.reason}>Reason: {row.reason}</Text> : null}
          <Text style={styles.source}>Source: {row.source}{row.user_id === session.userId ? ' · you' : ''}</Text>
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scope: { flexDirection: 'row', gap: 12 },
  scopeTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  scopeText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  chipScroll: { flexGrow: 0 },
  chips: { gap: 8, paddingRight: 8 },
  errorBox: { gap: 8 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  loading: { marginTop: 24 },
  row: { gap: 5, padding: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  action: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  meta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  target: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13, fontVariant: ['tabular-nums'] },
  details: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13 },
  reason: { color: colors.blue, fontFamily: Fonts.medium, fontSize: 12 },
  source: { color: '#94A3B8', fontFamily: Fonts.regular, fontSize: 11 },
});
