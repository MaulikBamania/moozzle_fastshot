import { useAuth } from '@fastshot/auth';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { authErrorMessage, InlineError } from '@/components/auth-ui';
import { AppScreen, Card, colors, DataGate, OptionChip, PageHeader, Pill, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { supabase } from '@/lib/supabase';
import { USER_ROLES, type ProfileRow, type UserRole } from '@/store/types';
import { loadBovineData, messageOf, useBovineData, useBovineStore } from '@/store/useBovineStore';
import { useIsOnline } from '@/store/useConnectivity';

export default function ProfileScreen() {
  return <DataGate><ProfileContent /></DataGate>;
}

function ProfileContent() {
  const { user, signOut } = useAuth();
  const profile = useBovineStore((state) => state.profile);
  const { animals, records, pendingCount } = useBovineData();
  const online = useIsOnline();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('Field Officer');
  const [phone, setPhone] = useState('');
  const [village, setVillage] = useState('');
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const startEditing = useCallback(() => {
    setFullName(profile?.full_name ?? '');
    setRole(profile?.role ?? 'Field Officer');
    setPhone(profile?.phone ?? '');
    setVillage(profile?.village ?? '');
    setError(null);
    setNotice(null);
    setEditing(true);
  }, [profile]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    if (!fullName.trim()) {
      setError('Enter your full name.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: ProfileRow = { id: user.id, full_name: fullName.trim(), role, phone: phone.trim(), village: village.trim() };
      const { error: saveError } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
      if (saveError) throw saveError;
      await loadBovineData();
      setEditing(false);
      setNotice('Profile saved.');
    } catch (caught) {
      console.error('Could not save profile', caught);
      setError(messageOf(caught, 'Your profile could not be saved.'));
    } finally {
      setSaving(false);
    }
  }, [fullName, phone, role, user, village]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      // AuthProvider returns to the sign-in screen.
    } catch (caught) {
      console.error('Sign out failed', caught);
      setError(authErrorMessage(caught, 'Unable to sign out. Please try again.'));
      setSigningOut(false);
    }
  }, [signOut]);

  const name = profile?.full_name?.trim() || 'MOOZZLE user';
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');

  return (
    <AppScreen scroll>
      <PageHeader eyebrow="Account" title="Your Profile" onBack={() => router.back()} />
      <Card style={styles.hero}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials || 'M'}</Text></View>
        <View style={styles.heroCopy}>
          <Text selectable style={styles.name}>{name}</Text>
          <Text selectable style={styles.email}>{user?.email ?? ''}</Text>
          <View style={styles.pills}>
            <Pill label={profile?.role ?? 'Field Officer'} />
            <Pill label={online ? 'Online' : 'Offline'} tone={online ? 'green' : 'amber'} />
          </View>
        </View>
      </Card>

      {notice ? <View style={styles.notice}><Ionicons name="checkmark-circle" size={18} color={colors.accent} /><Text style={styles.noticeText}>{notice}</Text></View> : null}

      <View style={styles.stats}>
        <Stat label="Bovines" value={animals.length} />
        <Stat label="Service entries" value={records.length} />
        <Stat label="Queued" value={pendingCount} tone={pendingCount > 0 ? 'amber' : 'green'} />
      </View>

      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Field details</Text>
          {!editing && <PrimaryButton label="Edit" icon="create-outline" variant="soft" onPress={startEditing} style={styles.smallButton} />}
        </View>
        {editing ? (
          <>
            <TextField label="Full name" value={fullName} onChangeText={setFullName} />
            <Text style={styles.label}>Role</Text>
            <View style={styles.roleRow}>{USER_ROLES.map((item) => <OptionChip key={item} label={item} selected={role === item} onPress={() => setRole(item)} />)}</View>
            <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <TextField label="Village" value={village} onChangeText={setVillage} />
            <View style={styles.row}>
              <PrimaryButton label="Cancel" variant="outline" onPress={() => { setEditing(false); setError(null); }} style={styles.flex} />
              <PrimaryButton label={saving ? 'Saving…' : 'Save'} icon="checkmark" onPress={() => void handleSave()} disabled={saving} style={styles.flex} />
            </View>
          </>
        ) : (
          <View style={styles.grid}>
            <Detail label="Role" value={profile?.role ?? '—'} />
            <Detail label="Phone" value={profile?.phone || '—'} />
            <Detail label="Village" value={profile?.village || '—'} />
            <Detail label="Member since" value={user?.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
          </View>
        )}
      </Card>

      <InlineError message={error} />
      <PrimaryButton label="Sync Manager" icon="sync-outline" variant="outline" onPress={() => router.push('/sync')} />
      <PrimaryButton label={signingOut ? 'Signing out…' : 'Sign Out'} icon="log-out-outline" variant="danger" onPress={() => void handleSignOut()} disabled={signingOut} />
      {pendingCount > 0 ? <Text style={styles.hint}>{pendingCount} queued item(s) stay on this device and will sync next time you sign in to this account.</Text> : null}
    </AppScreen>
  );
}

function Stat({ label, value, tone = 'green' }: { label: string; value: number; tone?: 'green' | 'amber' }) {
  return (
    <View style={styles.stat}>
      <Text selectable style={[styles.statValue, tone === 'amber' && styles.statAmber]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 22 },
  heroCopy: { flex: 1, gap: 4 },
  name: { color: colors.text, fontFamily: Fonts.bold, fontSize: 19 },
  email: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  pills: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  notice: { flexDirection: 'row', gap: 7, alignItems: 'center', padding: 11, borderRadius: 10, backgroundColor: colors.primaryLight },
  noticeText: { color: colors.primary, fontFamily: Fonts.medium, fontSize: 13 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, minHeight: 74, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 10, justifyContent: 'center', gap: 2 },
  statValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 24, fontVariant: ['tabular-nums'] },
  statAmber: { color: colors.warning },
  statLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11 },
  card: { gap: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  smallButton: { minHeight: 44, paddingHorizontal: 12 },
  label: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  detail: { width: '50%', gap: 3 },
  detailLabel: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  detailValue: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  hint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
