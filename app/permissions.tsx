import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { FormSheet } from '@/components/record-forms';
import { Card, colors, DataGate, OptionChip, Pill, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { isLevel, LEVELS, PERMISSION_LABELS, PERMISSIONS, ROLES, type Level, type Permission, type Role } from '@/lib/rbac';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { loadBovineData, useSession } from '@/store/useBovineStore';

const LEVEL_SPECS = LEVELS.map((level) => ({ title: level, fields: [{ key: 'reason', label: 'Reason for change', required: true, placeholder: 'e.g. Board resolution 14/2026' }] }));

export default function PermissionsScreen() {
  return (
    <DataGate>
      <StackScreen title="Roles & Permissions" eyebrow="Configurable matrix" destination="permissions">
        <PermissionsContent />
      </StackScreen>
    </DataGate>
  );
}

function PermissionsContent() {
  const session = useSession();
  const [notice, setNotice] = useState('');
  const [role, setRole] = useState<Role>('Veterinarian');
  const [edit, setEdit] = useState<{ permission: Permission; level: Level } | null>(null);
  const fetchMatrix = useCallback(async () => {
    const { data, error: queryError } = await supabase.from('role_permissions').select('role, permission, level');
    if (queryError) throw queryError;
    const next: Record<string, Level> = {};
    for (const row of data ?? []) if (isLevel(row.level)) next[`${row.role}|${row.permission}`] = row.level;
    return next;
  }, []);
  const { data: matrix, error, reload } = useAsyncResource(fetchMatrix, 'The permission matrix could not be loaded.');

  const rows = useMemo(() => PERMISSIONS.map((permission) => ({ permission, level: matrix?.[`${role}|${permission}`] ?? 'No' })), [matrix, role]);
  const save = useCallback(async (level: string, reason: string) => {
    if (!edit) return;
    const { error: rpcError } = await supabase.rpc('set_permission', { p_role: role, p_permission: edit.permission, p_level: level, p_reason: reason });
    if (rpcError) throw rpcError;
    setEdit(null);
    setNotice(`${role} · ${PERMISSION_LABELS[edit.permission]} set to ${level}. Change audited.`);
    await reload();
    void loadBovineData();
  }, [edit, reload, role]);

  return (
    <>
      <Text style={styles.muted}>The backend enforces this matrix through row-level security and checked server functions. Changes require privileged access and a reason, and are audited.</Text>
      {!session.privileged ? <Pill label="Read-only — start privileged access to edit" tone="amber" /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.hchips}>
        {ROLES.map((item) => <OptionChip key={item} label={item} selected={role === item} onPress={() => setRole(item)} />)}
      </ScrollView>
      {notice ? <Text selectable style={styles.ok}>{notice}</Text> : null}
      {error ? <View style={styles.gap}><Text selectable style={styles.error}>{error}</Text><PrimaryButton label="Retry" variant="outline" onPress={() => void reload()} /></View> : null}
      {!matrix && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {matrix ? (
        <Card style={styles.card}>
          {rows.map(({ permission, level }) => (
            <View key={permission} style={styles.row}>
              <Text style={styles.label}>{PERMISSION_LABELS[permission]}</Text>
              {session.privileged ? (
                <PrimaryButton label={level} variant="soft" onPress={() => setEdit({ permission, level })} style={styles.levelButton} />
              ) : (
                <Pill label={level} tone={level === 'No' ? 'slate' : 'blue'} />
              )}
            </View>
          ))}
        </Card>
      ) : null}
      {edit ? (
        <FormSheet
          visible
          heading={`${role} · ${PERMISSION_LABELS[edit.permission]}`}
          specs={LEVEL_SPECS}
          initialTitle={edit.level}
          submitLabel="Save Level"
          danger
          confirmText="Choose the new level above. Changing permissions affects every user with this role immediately."
          onClose={() => setEdit(null)}
          onSubmit={({ title, values }) => save(title, values.reason ?? '')}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  scroll: { flexGrow: 0 },
  hchips: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  card: { gap: 4 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  label: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 14 },
  levelButton: { minHeight: 40, paddingHorizontal: 12 },
});
