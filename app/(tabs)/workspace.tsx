import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { go, TabShell } from '@/components/app-chrome';
import { Card, colors, DataGate, Pill } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { canOpen, PERMISSION_LABELS, PERMISSIONS, type Destination, type NavItem, type Role } from '@/lib/rbac';
import { useAppStore } from '@/store/useAppStore';
import { useBovineStore, useSession } from '@/store/useBovineStore';

export default function WorkspaceScreen() {
  return (
    <DataGate>
      <TabShell active="workspace">
        <WorkspaceContent />
      </TabShell>
    </DataGate>
  );
}

const COMMON: NavItem[] = [
  { label: 'Notifications', icon: 'notifications-outline', to: 'notifications' },
  { label: 'My Requests', icon: 'chatbubbles-outline', to: 'requests' },
  { label: 'Audit Logs', icon: 'reader-outline', to: 'audit' },
  { label: 'Reports & Export', icon: 'bar-chart-outline', to: 'reports' },
  { label: 'Offline Records & Sync', icon: 'cloud-upload-outline', to: 'sync' },
  { label: 'Profile & Sign Out', icon: 'person-circle-outline', to: 'profile' },
];

function WorkspaceContent() {
  const session = useSession();
  const role = session.role as Role;
  const experience = session.experience;
  const queue = useAppStore((state) => state.syncQueue.length);
  const failed = useAppStore((state) => state.failedOps.length);
  const unread = useBovineStore((state) => state.notifications.filter((item) => !item.read).length);
  const pendingApprovals = useBovineStore((state) => state.animalRows.filter((a) => a.approval_status === 'Submitted' || a.approval_status === 'Pending Review').length + state.requestRows.filter((r) => r.status === 'Submitted' && r.requested_by !== state.userId).length);

  const tools = useMemo(() => {
    const seen = new Set<string>();
    return (experience?.nav ?? []).filter((item) => {
      const key = `${item.label}`;
      if (seen.has(key) || !canOpen(item.to, role, session.permissions)) return false;
      seen.add(key);
      return true;
    });
  }, [experience?.nav, role, session.permissions]);
  const common = useMemo(() => COMMON.filter((item) => canOpen(item.to, role, session.permissions) && !tools.some((tool) => tool.to === item.to)), [role, session.permissions, tools]);

  const badge = (to: Destination): string | null => {
    if (to === 'notifications' && unread) return String(unread);
    if (to === 'approvals' && pendingApprovals) return String(pendingApprovals);
    if (to === 'sync' && queue + failed) return String(queue + failed);
    return null;
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{experience?.short} Workspace</Text>
      <Text style={styles.subtitle}>Tools available to your active role. Items your role cannot use are not shown.</Text>
      <Card style={styles.list}>
        {tools.map((item, index) => <ToolRow key={`${item.label}-${index}`} item={item} badge={badge(item.to)} last={index === tools.length - 1} />)}
      </Card>
      <Text style={styles.section}>More</Text>
      <Card style={styles.list}>
        {common.map((item, index) => <ToolRow key={item.label} item={item} badge={badge(item.to)} last={index === common.length - 1} />)}
      </Card>
      <Text style={styles.section}>Your permissions</Text>
      <Card style={styles.matrix}>
        {PERMISSIONS.map((permission) => {
          const level = session.permissions[permission];
          return (
            <View key={permission} style={styles.permRow}>
              <Text style={styles.permLabel}>{PERMISSION_LABELS[permission]}</Text>
              <Pill label={level} tone={level === 'No' ? 'slate' : level === 'Full' || level === 'Authorised' ? 'green' : 'blue'} />
            </View>
          );
        })}
        {role === 'Super Administrator' ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/permissions')} style={styles.matrixLink}>
            <Text style={styles.matrixLinkText}>Edit permission matrix</Text>
          </Pressable>
        ) : (
          <Text style={styles.matrixNote}>Permissions are set by your administrator and enforced on the server.</Text>
        )}
      </Card>
    </ScrollView>
  );
}

function ToolRow({ item, badge, last }: { item: NavItem; badge: string | null; last: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={() => go(item.to)} style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.pressed]}>
      <View style={styles.icon}><Ionicons name={item.icon} size={20} color={colors.primaryDark} /></View>
      <Text style={styles.rowLabel}>{item.label}</Text>
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32, maxWidth: 760, width: '100%', alignSelf: 'center' },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 26 },
  subtitle: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  section: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 8 },
  list: { padding: 0, overflow: 'hidden' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, color: colors.text, fontFamily: Fonts.semiBold, fontSize: 15 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 11 },
  pressed: { backgroundColor: colors.slateLight },
  matrix: { gap: 8 },
  permRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 32 },
  permLabel: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  matrixLink: { paddingTop: 8, minHeight: 44, justifyContent: 'center' },
  matrixNote: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, paddingTop: 8 },
  matrixLinkText: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 13 },
});
