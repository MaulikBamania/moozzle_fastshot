import { useAuth } from '@fastshot/auth';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BiometricScanIcon, colors, LogoMark, tr } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { DEMO_ACCOUNTS, DEMO_MODE, DEMO_PASSWORD } from '@/lib/demo';
import { canOpen, DESTINATION_ROUTES, primaryTabs, ROLE_EXPERIENCE, type Destination, type Role } from '@/lib/rbac';
import { useAppStore } from '@/store/useAppStore';
import { logAudit, messageOf, switchRole, useBovineStore, useSession } from '@/store/useBovineStore';
import { useIsOnline } from '@/store/useConnectivity';
import type { Language } from '@/store/types';

export const WIDE_BREAKPOINT = 1024;

export function go(destination: Destination) {
  router.push(DESTINATION_ROUTES[destination] as never);
}

export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

export function RoleBadge({ role, compact = false }: { role: Role; compact?: boolean }) {
  const experience = ROLE_EXPERIENCE[role];
  return (
    <View style={[styles.roleBadge, { backgroundColor: `${experience.tone}14`, borderColor: `${experience.tone}40` }]}>
      <Ionicons name={experience.icon} size={compact ? 12 : 14} color={experience.tone} />
      <Text numberOfLines={1} style={[styles.roleBadgeText, { color: experience.tone }, compact && styles.roleBadgeTextCompact]}>{compact ? experience.short : role}</Text>
    </View>
  );
}

/** Common header: brand, active role (opens switcher), scope, language, notifications, profile. */
export function AppHeader() {
  const session = useSession();
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const unread = useBovineStore((state) => state.notifications.filter((item) => !item.read).length);
  const online = useIsOnline();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const initials = session.name.split(/\s+/).filter((part) => /[A-Za-z]/.test(part[0] ?? '')).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.brandRow}>
          <LogoMark compact />
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>MOOZZLE</Text>
            <View style={styles.onlineRow}>
              <View style={[styles.dot, !online && styles.dotOffline]} />
              <Text numberOfLines={1} style={[styles.onlineText, !online && styles.onlineTextOffline]}>{tr(language, online ? 'online' : 'offline')}</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerIcons}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`} onPress={() => router.push('/notifications')} style={styles.iconButton}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {unread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open profile for ${session.name}`} onPress={() => router.push('/profile')} style={styles.avatar}>
            {initials ? <Text style={styles.avatarText}>{initials}</Text> : <Ionicons name="person" size={16} color={colors.surface} />}
          </Pressable>
        </View>
      </View>
      <View style={styles.headerBottom}>
        {session.role ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Active role ${session.role}. Switch workspace or demo account`} onPress={() => setSwitcherOpen(true)} style={styles.roleButton}>
            <RoleBadge role={session.role} />
            <Ionicons name="chevron-down" size={14} color={colors.muted} />
          </Pressable>
        ) : null}
        <View style={styles.scopeChip}>
          <Ionicons name="location-outline" size={13} color={colors.muted} />
          <Text numberOfLines={1} style={styles.scopeText}>{session.scopeLabel}</Text>
        </View>
        <View style={styles.languageRow}>
          {(['EN', 'HI', 'GU'] as Language[]).map((item) => (
            <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Language ${item}`} accessibilityState={{ selected: language === item }} onPress={() => setLanguage(item)} style={[styles.langButton, language === item && styles.langButtonActive]}>
              <Text style={[styles.langText, language === item && styles.langTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <RoleSwitcherModal visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}

/** Switch between assigned roles (server-checked), or — in demo builds — sign in as another synthetic account. */
export function RoleSwitcherModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const session = useSession();
  const { signInWithEmail, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const chooseRole = useCallback(async (role: Role) => {
    setError('');
    if (role === session.role) {
      onClose();
      return;
    }
    setBusy(role);
    try {
      await switchRole(role);
      onClose();
      router.replace('/(tabs)');
    } catch (caught) {
      console.error('Role switch failed', caught);
      setError(messageOf(caught, 'The workspace could not be switched.'));
    } finally {
      setBusy(null);
    }
  }, [onClose, session.role]);

  const chooseAccount = useCallback(async (email: string) => {
    setError('');
    if (email === user?.email) {
      onClose();
      return;
    }
    setBusy(email);
    try {
      await logAudit('auth.logout', '', 'Demo account switch');
      await signInWithEmail(email, DEMO_PASSWORD);
      onClose();
      router.replace('/(tabs)');
    } catch (caught) {
      console.error('Demo account sign-in failed', caught);
      setError(messageOf(caught, 'That demo account could not sign in.'));
    } finally {
      setBusy(null);
    }
  }, [onClose, signInWithEmail, user?.email]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Close workspace switcher" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Choose your workspace</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            <Text style={styles.sheetSection}>Roles assigned to {session.name}</Text>
            {session.roles.map((role) => (
              <Pressable key={role} accessibilityRole="button" accessibilityState={{ selected: role === session.role }} onPress={() => void chooseRole(role)} disabled={!!busy} style={[styles.roleRow, role === session.role && styles.roleRowActive]}>
                <View style={[styles.roleIcon, { backgroundColor: `${ROLE_EXPERIENCE[role].tone}18` }]}><Ionicons name={ROLE_EXPERIENCE[role].icon} size={20} color={ROLE_EXPERIENCE[role].tone} /></View>
                <View style={styles.roleCopy}>
                  <Text style={styles.roleName}>{role}</Text>
                  <Text style={styles.roleMeta}>{ROLE_EXPERIENCE[role].subtitle}</Text>
                </View>
                {busy === role ? <ActivityIndicator color={colors.primary} /> : role === session.role ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
              </Pressable>
            ))}
            <Text style={styles.sheetHint}>Only roles assigned by an administrator are listed. The server re-checks every switch.</Text>
            {DEMO_MODE ? (
              <>
                <View style={styles.demoHeader}>
                  <Text style={styles.sheetSection}>Synthetic demo accounts</Text>
                  <View style={styles.demoPill}><Text style={styles.demoPillText}>DEMO BUILD</Text></View>
                </View>
                {DEMO_ACCOUNTS.map((account) => {
                  const current = account.email === user?.email;
                  return (
                    <Pressable key={account.email} accessibilityRole="button" accessibilityLabel={`Sign in as demo ${account.role}`} onPress={() => void chooseAccount(account.email)} disabled={!!busy} style={[styles.roleRow, current && styles.roleRowActive]}>
                      <View style={[styles.roleIcon, { backgroundColor: `${ROLE_EXPERIENCE[account.role].tone}18` }]}><Ionicons name={ROLE_EXPERIENCE[account.role].icon} size={18} color={ROLE_EXPERIENCE[account.role].tone} /></View>
                      <View style={styles.roleCopy}>
                        <Text style={styles.roleName}>{account.email === 'demo.multirole@moozzle.com' ? 'Multi-role account' : account.role}</Text>
                        <Text style={styles.roleMeta}>{account.name} · {account.note}</Text>
                      </View>
                      {busy === account.email ? <ActivityIndicator color={colors.primary} /> : current ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : <Ionicons name="log-in-outline" size={18} color={colors.muted} />}
                    </Pressable>
                  );
                })}
              </>
            ) : null}
            {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type TabKey = 'home' | 'identify' | 'records' | 'workspace';

const TAB_META: Record<TabKey, { icon: keyof typeof Ionicons.glyphMap; labelKey: string; route: string }> = {
  home: { icon: 'home', labelKey: 'home', route: '/(tabs)' },
  identify: { icon: 'scan-outline', labelKey: 'identify', route: '/(tabs)/identify' },
  records: { icon: 'albums-outline', labelKey: 'records', route: '/(tabs)/records' },
  workspace: { icon: 'grid-outline', labelKey: 'workspace', route: '/(tabs)/workspace' },
};

function BottomTabs({ active }: { active: TabKey }) {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const language = useAppStore((state) => state.language);
  const tabs = useMemo(() => (session.role ? primaryTabs(session.role, session.permissions).filter((tab) => tab.enabled) : []), [session.permissions, session.role]);
  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map(({ key }) => {
        const meta = TAB_META[key];
        const selected = active === key;
        const label = key === 'records' && session.role === 'Farmer' ? tr(language, 'myAnimals') : tr(language, meta.labelKey);
        return (
          <Pressable key={key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => router.replace(meta.route as never)} style={styles.tabButton}>
            {key === 'identify' ? <BiometricScanIcon size={26} color={selected ? colors.primary : colors.muted} /> : <Ionicons name={meta.icon} size={25} color={selected ? colors.primary : colors.muted} />}
            <Text numberOfLines={1} style={[styles.tabLabel, selected && styles.tabLabelActive]}>{label}</Text>
            {selected ? <View style={styles.tabIndicator} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Sidebar({ active }: { active: TabKey }) {
  const session = useSession();
  const language = useAppStore((state) => state.language);
  if (!session.role || !session.experience) return null;
  const tabs = primaryTabs(session.role, session.permissions).filter((tab) => tab.enabled);
  const items = session.experience.nav.filter((item) => canOpen(item.to, session.role as Role, session.permissions));
  return (
    <View style={styles.sidebar}>
      <ScrollView contentContainerStyle={styles.sidebarContent}>
        {tabs.map(({ key }) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active === key }} onPress={() => router.replace(TAB_META[key].route as never)} style={[styles.sideItem, active === key && styles.sideItemActive]}>
            <Ionicons name={TAB_META[key].icon} size={19} color={active === key ? colors.primary : colors.muted} />
            <Text style={[styles.sideLabel, active === key && styles.sideLabelActive]}>{tr(language, TAB_META[key].labelKey)}</Text>
          </Pressable>
        ))}
        <Text style={styles.sideSection}>{session.experience.short}</Text>
        {items.map((item) => (
          <Pressable key={`${item.label}-${item.to}`} accessibilityRole="link" onPress={() => go(item.to)} style={styles.sideItem}>
            <Ionicons name={item.icon} size={18} color={colors.muted} />
            <Text numberOfLines={1} style={styles.sideLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Layout for the four tab screens: header + (sidebar on desktop | bottom tabs on mobile). */
export function TabShell({ active, children }: { active: TabKey; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  return (
    <View style={[styles.shell, { paddingTop: insets.top }]}>
      <AppHeader />
      <View style={styles.shellBody}>
        {wide ? <Sidebar active={active} /> : null}
        <View style={styles.shellMain}>{children}</View>
      </View>
      {wide ? null : <BottomTabs active={active} />}
    </View>
  );
}

/** Deny-by-default route guard: unauthorised direct URLs land on Permission Denied. */
export function RequireAccess({ destination, children }: { destination: Destination; children: React.ReactNode }) {
  const session = useSession();
  if (!session.role || !canOpen(destination, session.role, session.permissions)) {
    return <Redirect href={{ pathname: '/permission-denied', params: { resource: destination } }} />;
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  shellBody: { flex: 1, flexDirection: 'row' },
  shellMain: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 10, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  brandCopy: { flex: 1, minWidth: 0 },
  brandName: { color: colors.primaryDark, fontFamily: Fonts.bold, fontSize: 21, letterSpacing: 0.4 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  dotOffline: { backgroundColor: colors.warning },
  onlineText: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 0.2 },
  onlineTextOffline: { color: colors.warning },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  badge: { position: 'absolute', top: 5, right: 5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 14 },
  headerBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  roleButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 230 },
  roleBadgeText: { fontFamily: Fonts.bold, fontSize: 12, flexShrink: 1 },
  roleBadgeTextCompact: { fontSize: 11 },
  scopeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 90 },
  scopeText: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12, flexShrink: 1 },
  languageRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  langButton: { minWidth: 38, minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  langButtonActive: { backgroundColor: colors.primaryLight },
  langText: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12 },
  langTextActive: { color: colors.primaryDark, fontFamily: Fonts.bold },
  modalRoot: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '86%', backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 8 },
  sheetTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 20 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slateLight },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: 18, paddingBottom: 12, gap: 8 },
  sheetSection: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 6 },
  sheetHint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  roleRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  roleRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  roleCopy: { flex: 1, gap: 2 },
  roleName: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  roleMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  demoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  demoPill: { backgroundColor: colors.warningLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  demoPillText: { color: colors.warning, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.6 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, marginTop: 6 },
  bottomNav: { minHeight: 68, paddingTop: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'space-around' },
  tabButton: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'flex-start', gap: 2 },
  tabLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  tabLabelActive: { color: colors.primary, fontFamily: Fonts.bold },
  tabIndicator: { height: 3, width: 40, borderRadius: 2, backgroundColor: colors.primary, marginTop: 3 },
  sidebar: { width: 252, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.surface },
  sidebarContent: { padding: 12, gap: 2 },
  sideItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 12 },
  sideItemActive: { backgroundColor: colors.primaryLight },
  sideLabel: { color: colors.text, fontFamily: Fonts.medium, fontSize: 14, flexShrink: 1 },
  sideLabelActive: { color: colors.primaryDark, fontFamily: Fonts.bold },
  sideSection: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 16, marginBottom: 4, paddingHorizontal: 12 },
});

/** Pushed-screen frame: back header + scrollable content, optional permission guard. */
export function StackScreen({ title, eyebrow, destination, children, right }: { title: string; eyebrow?: string; destination?: Destination; children: React.ReactNode; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const body = (
    <View style={[frame.page, { paddingTop: insets.top }]}>
      <View style={frame.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} style={frame.back}>
          <Ionicons name="arrow-back" size={21} color={colors.text} />
        </Pressable>
        <View style={frame.copy}>
          {eyebrow ? <Text style={frame.eyebrow}>{eyebrow}</Text> : null}
          <Text style={frame.title}>{title}</Text>
        </View>
        {right}
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={frame.flex} contentContainerStyle={[frame.content, { paddingBottom: insets.bottom + 32 }]}>
        {children}
      </ScrollView>
    </View>
  );
  return destination ? <RequireAccess destination={destination}>{body}</RequireAccess> : body;
}

const frame = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  copy: { flex: 1, gap: 1 },
  eyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 22 },
  content: { padding: 16, gap: 12, maxWidth: 860, width: '100%', alignSelf: 'center' },
});
