import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { Card, colors, DataGate, EmptyState, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { markNotificationsRead, messageOf, saveNotificationPrefs, useBovineStore, useSession } from '@/store/useBovineStore';
import type { NotificationRow } from '@/store/types';

const TYPES: { key: NotificationRow['type']; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'alert', label: 'Urgent alerts', icon: 'warning-outline' },
  { key: 'approval', label: 'Approvals & requests', icon: 'checkmark-done-outline' },
  { key: 'reminder', label: 'Reminders (vaccination, follow-ups)', icon: 'alarm-outline' },
  { key: 'sync', label: 'Synchronisation', icon: 'sync-outline' },
  { key: 'security', label: 'Security & role changes', icon: 'shield-outline' },
  { key: 'integration', label: 'Integrations', icon: 'code-slash-outline' },
  { key: 'info', label: 'General updates', icon: 'information-circle-outline' },
];

export default function NotificationsScreen() {
  return (
    <DataGate>
      <StackScreen title="Notifications" eyebrow="Role alerts">
        <NotificationsContent />
      </StackScreen>
    </DataGate>
  );
}

function NotificationsContent() {
  const session = useSession();
  const notifications = useBovineStore((state) => state.notifications);
  const prefs = useBovineStore((state) => state.profile?.notification_prefs ?? {});
  const [error, setError] = useState('');
  const [showPrefs, setShowPrefs] = useState(false);
  const muted = useCallback((type: string) => prefs[type] === false, [prefs]);
  // Each user sees notifications addressed to them for their active role.
  const visible = useMemo(() => notifications.filter((item) => item.user_role === session.role && !muted(item.type)), [muted, notifications, session.role]);
  const otherRoles = notifications.filter((item) => item.user_role !== session.role && !item.read).length;
  const unreadIds = visible.filter((item) => !item.read).map((item) => item.id);

  const open = useCallback(async (item: NotificationRow) => {
    setError('');
    try {
      if (!item.read) await markNotificationsRead([item.id]);
      if (item.link) router.push(item.link as never);
    } catch (caught) {
      console.error('Notification update failed', caught);
      setError(messageOf(caught, 'The notification could not be updated.'));
    }
  }, []);
  const markAll = useCallback(async () => {
    setError('');
    try {
      await markNotificationsRead(unreadIds);
    } catch (caught) {
      console.error('Mark all read failed', caught);
      setError(messageOf(caught, 'Notifications could not be marked as read.'));
    }
  }, [unreadIds]);
  const toggle = useCallback(async (type: string, enabled: boolean) => {
    setError('');
    try {
      await saveNotificationPrefs({ ...prefs, [type]: enabled });
    } catch (caught) {
      console.error('Saving notification preferences failed', caught);
      setError(messageOf(caught, 'Preferences could not be saved.'));
    }
  }, [prefs]);

  return (
    <>
      <View style={styles.toolbar}>
        <PrimaryButton label={`Mark all read (${unreadIds.length})`} variant="soft" icon="checkmark-done-outline" onPress={() => void markAll()} disabled={unreadIds.length === 0} style={styles.flex} />
        <PrimaryButton label="Preferences" variant="outline" icon="options-outline" onPress={() => setShowPrefs((value) => !value)} style={styles.flex} />
      </View>
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      {showPrefs ? (
        <Card style={styles.prefs}>
          {TYPES.map((type) => (
            <View key={type.key} style={styles.prefRow}>
              <Ionicons name={type.icon} size={18} color={colors.muted} />
              <Text style={styles.prefLabel}>{type.label}</Text>
              <Switch accessibilityLabel={`Show ${type.label}`} value={!muted(type.key)} onValueChange={(value) => void toggle(type.key, value)} trackColor={{ false: '#CBD5E1', true: '#6EE7B7' }} thumbColor={muted(type.key) ? '#F8FAFC' : colors.primary} />
            </View>
          ))}
        </Card>
      ) : null}
      {otherRoles > 0 ? <Text style={styles.meta}>{otherRoles} unread notification{otherRoles === 1 ? '' : 's'} belong to your other workspaces.</Text> : null}
      {visible.length === 0 ? <EmptyState title="You're all caught up" message="Notifications for your active role appear here." /> : null}
      {visible.map((item) => (
        <Pressable key={item.id} accessibilityRole="button" onPress={() => void open(item)} style={({ pressed }) => [styles.item, !item.read && styles.unread, pressed && styles.pressed]}>
          <View style={[styles.icon, item.type === 'alert' && styles.iconRed]}><Ionicons name={TYPES.find((type) => type.key === item.type)?.icon ?? 'notifications-outline'} size={19} color={item.type === 'alert' ? colors.danger : colors.primaryDark} /></View>
          <View style={styles.flex}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.message}>{item.message}</Text>
            <Text style={styles.meta}>{new Date(item.created_at).toLocaleString()}</Text>
          </View>
          {!item.read ? <View style={styles.dot} /> : null}
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toolbar: { flexDirection: 'row', gap: 10 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  prefs: { gap: 6 },
  prefRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  prefLabel: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 14 },
  item: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  unread: { borderColor: colors.primary },
  pressed: { opacity: 0.85 },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  iconRed: { backgroundColor: colors.dangerLight },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  message: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  meta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 },
});
