import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreen, go } from '@/components/app-chrome';
import { Card, colors, DataGate, EmptyState, OptionChip, Pill, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { ROLES, type Role } from '@/lib/rbac';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { loadBovineData, messageOf, useBovineStore, useSession } from '@/store/useBovineStore';
import type { UserRoleRow } from '@/store/types';

interface ScopedUser {
  id: string;
  full_name: string;
  email: string;
  active_role: string;
  roles: UserRoleRow[];
}

const ORG_ASSIGNABLE: Role[] = ['Veterinarian', 'AI Technician', 'Farm Manager', 'Field Worker', 'Farmer'];

export default function UsersScreen() {
  return (
    <DataGate>
      <StackScreen title="Users & Roles" eyebrow="Access management" destination="users">
        <UsersContent />
      </StackScreen>
    </DataGate>
  );
}

function UsersContent() {
  const session = useSession();
  const organisations = useBovineStore((state) => state.organisations);
  const farms = useBovineStore((state) => state.farms);
  const [actionError, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('Field Worker');
  const [orgId, setOrgId] = useState<string | null>(session.scope?.organisation_id ?? null);
  const [farmIds, setFarmIds] = useState<string[]>([]);
  const [districts, setDistricts] = useState('');
  const [busy, setBusy] = useState(false);
  const isSuper = session.role === 'Super Administrator';
  const canManage = (isSuper && session.privileged) || session.permissions.manage_users === 'Scoped';
  const assignable = isSuper ? [...ROLES] : ORG_ASSIGNABLE;

  const fetchUsers = useCallback(async () => {
    const [profiles, roles] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, active_role').order('full_name'),
      supabase.from('user_roles').select('id, user_id, role, organisation_id, farm_ids, districts, created_at'),
    ]);
    if (profiles.error) throw profiles.error;
    if (roles.error) throw roles.error;
    const roleRows = (roles.data ?? []) as UserRoleRow[];
    return (profiles.data ?? []).map((profile) => ({ ...(profile as Omit<ScopedUser, 'roles'>), roles: roleRows.filter((row) => row.user_id === profile.id) }));
  }, []);
  const { data: users, error: loadError, reload } = useAsyncResource<ScopedUser[]>(fetchUsers, 'Users could not be loaded.');
  const error = actionError || loadError;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter((user) => !q || user.full_name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q) || user.roles.some((item) => item.role.toLowerCase().includes(q)));
  }, [query, users]);
  const orgName = useCallback((id: string | null) => organisations.find((org) => org.id === id)?.name ?? 'No organisation', [organisations]);
  const orgFarms = useMemo(() => farms.filter((farm) => farm.organisation_id === orgId), [farms, orgId]);

  const assign = useCallback(async (userId: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('assign_role', { p_user: userId, p_role: role, p_org: orgId, p_farms: farmIds, p_districts: districts.split(',').map((item) => item.trim()).filter(Boolean) });
      if (rpcError) throw rpcError;
      setNotice(`${role} assigned. The change is audited and applies on the user's next refresh.`);
      setEditing(null);
      await reload();
    } catch (caught) {
      console.error('Assign role failed', caught);
      setError(messageOf(caught, 'The role could not be assigned.'));
    } finally {
      setBusy(false);
    }
  }, [districts, farmIds, orgId, reload, role]);

  const revoke = useCallback(async (userId: string, target: Role) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('revoke_role', { p_user: userId, p_role: target });
      if (rpcError) throw rpcError;
      setNotice(`${target} revoked. Access ends immediately on the server.`);
      await reload();
      void loadBovineData();
    } catch (caught) {
      console.error('Revoke role failed', caught);
      setError(messageOf(caught, 'The role could not be revoked.'));
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return (
    <>
      {isSuper && !session.privileged ? (
        <Card style={styles.card}>
          <Text style={styles.title}>Privileged access required</Text>
          <Text style={styles.muted}>Assigning or revoking roles is a high-risk operation. Start a justified privileged session first.</Text>
          <PrimaryButton label="Open Security" icon="lock-open-outline" onPress={() => go('security')} />
        </Card>
      ) : null}
      {!isSuper && session.permissions.manage_users === 'Limited' ? <Text style={styles.muted}>Your role can view staff in your scope. Role changes are made by your organisation administrator.</Text> : null}
      <TextField label="Search users" value={query} onChangeText={setQuery} placeholder="Name, email or role" autoCapitalize="none" />
      {notice ? <Text selectable style={styles.ok}>{notice}</Text> : null}
      {error ? <View style={styles.gap}><Text selectable style={styles.error}>{error}</Text><PrimaryButton label="Retry" variant="outline" onPress={() => { setError(''); void reload(); }} /></View> : null}
      {!users && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {users && filtered.length === 0 ? <EmptyState title="No users in scope" message="Users who share your organisation appear here." /> : null}
      {filtered.map((user) => (
        <Card key={user.id} style={styles.card}>
          <Text style={styles.title}>{user.full_name || user.email}</Text>
          <Text selectable style={styles.muted}>{user.email} · active: {user.active_role}</Text>
          {user.roles.map((item) => (
            <View key={item.id} style={styles.roleRow}>
              <View style={styles.flex}>
                <Pill label={item.role} tone="blue" />
                <Text style={styles.scope}>{orgName(item.organisation_id)}{item.farm_ids.length ? ` · ${farms.filter((farm) => item.farm_ids.includes(farm.id)).map((farm) => farm.name).join(', ')}` : ''}{item.districts.length ? ` · ${item.districts.join(', ')}` : ''}</Text>
              </View>
              {canManage && user.id !== session.userId && user.roles.length > 1 ? <PrimaryButton label="Revoke" variant="danger" onPress={() => void revoke(user.id, item.role)} disabled={busy} style={styles.small} /> : null}
            </View>
          ))}
          {canManage && user.id !== session.userId ? (
            editing === user.id ? (
              <View style={styles.gap}>
                <Text style={styles.label}>Role</Text>
                <View style={styles.chips}>{assignable.map((item) => <OptionChip key={item} label={item} selected={role === item} onPress={() => setRole(item)} />)}</View>
                {isSuper ? (
                  <>
                    <Text style={styles.label}>Organisation</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.hchips}>{organisations.map((org) => <OptionChip key={org.id} label={org.name} selected={orgId === org.id} onPress={() => { setOrgId(org.id); setFarmIds([]); }} />)}</ScrollView>
                    <TextField label="Districts (comma-separated, for officers/inspectors)" value={districts} onChangeText={setDistricts} placeholder="Sabarkantha, Mehsana" />
                  </>
                ) : null}
                {orgFarms.length ? (
                  <>
                    <Text style={styles.label}>Assigned farms</Text>
                    <View style={styles.chips}>{orgFarms.map((farm) => <OptionChip key={farm.id} label={farm.name} selected={farmIds.includes(farm.id)} onPress={() => setFarmIds((current) => (current.includes(farm.id) ? current.filter((id) => id !== farm.id) : [...current, farm.id]))} />)}</View>
                  </>
                ) : null}
                <View style={styles.row}>
                  <PrimaryButton label="Cancel" variant="outline" onPress={() => setEditing(null)} style={styles.flex} />
                  <PrimaryButton label={busy ? 'Saving…' : 'Assign Role'} onPress={() => void assign(user.id)} disabled={busy} style={styles.flex} />
                </View>
              </View>
            ) : (
              <PrimaryButton label="Assign Role / Scope" icon="key-outline" variant="soft" onPress={() => { setEditing(user.id); setOrgId(session.scope?.organisation_id ?? null); setFarmIds([]); setDistricts(''); }} />
            )
          ) : null}
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 8 },
  card: { gap: 8 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  label: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scope: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 4 },
  small: { minHeight: 40, paddingHorizontal: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scroll: { flexGrow: 0 },
  hchips: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  row: { flexDirection: 'row', gap: 10 },
});
