import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { Card, colors, DataGate, EmptyState, OptionChip, Pill, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import type { ApiLogRow } from '@/lib/dashboard';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { messageOf, useBovineStore } from '@/store/useBovineStore';

interface ApiClient {
  id: string;
  name: string;
  organisation_id: string;
  scopes: string[];
  rate_limit_per_min: number;
  webhook_url: string;
  status: 'Active' | 'Revoked';
  key_prefix: string;
  created_at: string;
  rotated_at: string | null;
}

const SCOPES: { key: string; label: string }[] = [
  { key: 'animals:verify', label: 'Verify animal identity' },
  { key: 'animals:read:scoped', label: 'Read animals in client organisation' },
  { key: 'services:write:ai', label: 'Write AI service records' },
  { key: 'services:write:health', label: 'Write health records' },
  { key: 'sync:upload', label: 'Upload offline sync batches' },
  { key: 'reports:aggregate', label: 'Aggregated reports only' },
  { key: 'webhooks:receive', label: 'Receive webhooks' },
];

export default function ApiClientsScreen() {
  return (
    <DataGate>
      <StackScreen title="API & Integrations" eyebrow="Scoped credentials" destination="api">
        <ApiContent />
      </StackScreen>
    </DataGate>
  );
}

function ApiContent() {
  const organisations = useBovineStore((state) => state.organisations);
  const [actionError, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>(['animals:verify']);
  const [rate, setRate] = useState('120');
  const [webhook, setWebhook] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    const [clientResult, logResult] = await Promise.all([
      supabase.from('api_clients').select('id, name, organisation_id, scopes, rate_limit_per_min, webhook_url, status, key_prefix, created_at, rotated_at').order('created_at', { ascending: false }),
      supabase.from('api_request_logs').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    if (clientResult.error) throw clientResult.error;
    if (logResult.error) throw logResult.error;
    return { clients: (clientResult.data ?? []) as ApiClient[], logs: (logResult.data ?? []) as ApiLogRow[] };
  }, []);
  const { data, error: loadError, reload } = useAsyncResource(fetchAll, 'Integration data could not be loaded.');
  const clients = data?.clients ?? null;
  const logs = data?.logs ?? [];
  const error = actionError || loadError;

  const call = useCallback(async (fn: string, args: Record<string, unknown>, success: string, clientName = '') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc(fn, args);
      if (rpcError) throw rpcError;
      const result = data as { secret?: string } | null;
      if (result?.secret) setSecret({ name: clientName, value: result.secret });
      setNotice(success);
      await reload();
      return true;
    } catch (caught) {
      console.error(`${fn} failed`, caught);
      setError(messageOf(caught, 'The integration change could not be saved.'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const create = useCallback(async () => {
    if (name.trim().length < 3 || !orgId || scopes.length === 0) {
      setError('Enter a name, choose the organisation and at least one scope.');
      return;
    }
    const ok = await call('create_api_client', { p_name: name.trim(), p_org: orgId, p_scopes: scopes, p_rate: Number(rate) || 120, p_webhook: webhook.trim() }, 'Client created. Copy the secret now — it is shown only once and stored only as a hash.', name.trim());
    if (ok) {
      setCreating(false);
      setName('');
    }
  }, [call, name, orgId, rate, scopes, webhook]);

  const copySecret = useCallback(async () => {
    if (!secret) return;
    try {
      await Clipboard.setStringAsync(secret.value);
      setNotice('Secret copied. Store it in the client system’s secret manager, never in a browser or app.');
    } catch (caught) {
      console.error('Copy failed', caught);
      setError('Copy is unavailable here; select the secret text instead.');
    }
  }, [secret]);

  const failures = logs.filter((log) => log.status_code >= 400).length;

  return (
    <>
      <Card style={styles.card}>
        <Text style={styles.title}>Integration health</Text>
        <View style={styles.stats}>
          <Stat label="Requests" value={String(logs.length)} />
          <Stat label="Successful" value={String(logs.length - failures)} />
          <Stat label="Failed" value={String(failures)} />
          <Stat label="Auth failures" value={String(logs.filter((log) => log.status_code === 401).length)} />
        </View>
        <Text style={styles.muted}>Credentials are scoped to one organisation and an explicit endpoint list. Wildcard or full-database scopes cannot be granted, and technical access never includes clinical or insurance permissions.</Text>
        <PrimaryButton label="API Documentation" icon="book-outline" variant="outline" onPress={() => router.push('/api-docs')} />
      </Card>
      {secret ? (
        <Card style={[styles.card, styles.secret]}>
          <Text style={styles.title}>New secret for {secret.name || 'client'}</Text>
          <Text selectable style={styles.secretText}>{secret.value}</Text>
          <Text style={styles.muted}>Shown once. MOOZZLE keeps only a SHA-256 hash.</Text>
          <View style={styles.row}>
            <PrimaryButton label="Copy" icon="copy-outline" variant="outline" onPress={() => void copySecret()} style={styles.flex} />
            <PrimaryButton label="I have stored it" onPress={() => setSecret(null)} style={styles.flex} />
          </View>
        </Card>
      ) : null}
      {notice ? <Text selectable style={styles.ok}>{notice}</Text> : null}
      {error ? <View style={styles.gap}><Text selectable style={styles.error}>{error}</Text><PrimaryButton label="Retry" variant="outline" onPress={() => { setError(''); void reload(); }} /></View> : null}

      <View style={styles.rowBetween}>
        <Text style={styles.section}>API clients</Text>
        <PrimaryButton label={creating ? 'Close' : 'Register Client'} icon={creating ? 'close' : 'add'} variant="soft" onPress={() => setCreating((value) => !value)} style={styles.small} />
      </View>
      {creating ? (
        <Card style={styles.card}>
          <TextField label="Client name" value={name} onChangeText={setName} placeholder="e.g. Dudhsagar Milk Collection App" />
          <Text style={styles.label}>Organisation scope</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.hchips}>{organisations.map((org) => <OptionChip key={org.id} label={org.name} selected={orgId === org.id} onPress={() => setOrgId(org.id)} />)}</ScrollView>
          <Text style={styles.label}>Endpoint permissions</Text>
          <View style={styles.chips}>{SCOPES.map((scope) => <OptionChip key={scope.key} label={scope.label} selected={scopes.includes(scope.key)} onPress={() => setScopes((current) => (current.includes(scope.key) ? current.filter((item) => item !== scope.key) : [...current, scope.key]))} />)}</View>
          <TextField label="Rate limit (requests / minute)" value={rate} onChangeText={setRate} keyboardType="numeric" />
          <TextField label="Webhook URL (optional)" value={webhook} onChangeText={setWebhook} autoCapitalize="none" placeholder="https://…" />
          <PrimaryButton label={busy ? 'Creating…' : 'Create Scoped Client'} onPress={() => void create()} disabled={busy} />
        </Card>
      ) : null}
      {!clients && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {clients?.length === 0 ? <EmptyState title="No API clients" message="Register an approved integration to issue a scoped credential." /> : null}
      {clients?.map((client) => (
        <Card key={client.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.title}>{client.name}</Text>
            <Pill label={client.status} tone={client.status === 'Active' ? 'green' : 'slate'} />
          </View>
          <Text style={styles.muted}>{organisations.find((org) => org.id === client.organisation_id)?.name ?? 'Organisation'} · key {client.key_prefix}•••• · {client.rate_limit_per_min}/min</Text>
          <View style={styles.chips}>{client.scopes.map((scope) => <Pill key={scope} label={scope} tone="blue" />)}</View>
          {client.webhook_url ? <Text selectable style={styles.muted}>Webhook: {client.webhook_url}</Text> : null}
          <Text style={styles.meta}>Created {new Date(client.created_at).toLocaleDateString()}{client.rotated_at ? ` · rotated ${new Date(client.rotated_at).toLocaleDateString()}` : ''}</Text>
          {client.status === 'Active' ? (
            <View style={styles.row}>
              <PrimaryButton label="Rotate Key" variant="outline" onPress={() => void call('rotate_api_key', { p_id: client.id }, 'Key rotated. The previous key no longer works.', client.name)} disabled={busy} style={styles.flex} />
              <PrimaryButton label="Revoke" variant="danger" onPress={() => void call('update_api_client', { p_id: client.id, p_scopes: client.scopes, p_rate: client.rate_limit_per_min, p_status: 'Revoked' }, `${client.name} revoked.`)} disabled={busy} style={styles.flex} />
            </View>
          ) : null}
        </Card>
      ))}

      <Text style={styles.section}>Integration logs</Text>
      {logs.length === 0 ? <EmptyState title="No requests yet" message="API calls from registered clients are logged here." /> : null}
      {logs.map((log) => (
        <View key={log.id} style={styles.log}>
          <Pill label={String(log.status_code)} tone={log.status_code < 400 ? 'green' : log.status_code === 429 ? 'amber' : 'red'} />
          <View style={styles.flex}>
            <Text style={styles.logEndpoint}>{log.method} {log.endpoint}</Text>
            <Text style={styles.meta}>{new Date(log.created_at).toLocaleString()} · {log.latency_ms} ms{log.error ? ` · ${log.error}` : ''}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 8 },
  card: { gap: 10 },
  title: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  section: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, marginTop: 6 },
  label: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  meta: { color: '#94A3B8', fontFamily: Fonts.regular, fontSize: 11 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.slateLight, borderRadius: 12, padding: 10, alignItems: 'center' },
  statValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 20, fontVariant: ['tabular-nums'] },
  statLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11, textAlign: 'center' },
  secret: { borderColor: colors.warning, backgroundColor: colors.warningLight },
  secretText: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  small: { minHeight: 42, paddingHorizontal: 12 },
  scroll: { flexGrow: 0 },
  hchips: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  log: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10 },
  logEndpoint: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
});
