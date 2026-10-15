import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { AnimalOverview } from '@/components/animal-overview';
import { go, TabShell, useIsWide } from '@/components/app-chrome';
import { AnimalPhoto, Card, colors, DataGate, formatMoozzleId, LogoMark, Pill, PrimaryButton, tr } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { tagLabel } from '@/lib/tag-id';
import type { AnimalCategory } from '@/lib/demographics';
import { buildDashboard, type ApiLogRow, type DashCard, type PlatformOverview, type ResearchRow } from '@/lib/dashboard';
import { canOpen, ROLE_EXPERIENCE, type Role } from '@/lib/rbac';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useAppStore } from '@/store/useAppStore';
import { confirmRole, loadBovineData, messageOf, switchRole, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';

export default function HomeScreen() {
  return (
    <DataGate>
      <WorkspaceGate />
    </DataGate>
  );
}

/** Multi-role users choose an authorised workspace after signing in. */
function WorkspaceGate() {
  const session = useSession();
  const confirmed = useBovineStore((state) => state.roleConfirmed);
  if (session.roles.length > 1 && !confirmed) return <WorkspaceChooser />;
  return (
    <TabShell active="home">
      <Dashboard />
    </TabShell>
  );
}

function WorkspaceChooser() {
  const session = useSession();
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState('');
  const choose = useCallback(async (role: Role) => {
    setError('');
    setBusy(role);
    try {
      if (role === session.role) confirmRole();
      else await switchRole(role);
    } catch (caught) {
      console.error('Workspace selection failed', caught);
      setError(messageOf(caught, 'That workspace could not be opened.'));
    } finally {
      setBusy(null);
    }
  }, [session.role]);
  return (
    <ScrollView style={styles.chooserPage} contentContainerStyle={styles.chooserContent}>
      <LogoMark />
      <Text style={styles.chooserTitle}>Welcome to MOOZZLE</Text>
      <Text style={styles.chooserSubtitle}>{session.name}, choose your workspace:</Text>
      {session.roles.map((role) => (
        <Pressable key={role} accessibilityRole="button" onPress={() => void choose(role)} disabled={!!busy} style={({ pressed }) => [styles.chooserRow, pressed && styles.pressed]}>
          <View style={[styles.chooserIcon, { backgroundColor: `${ROLE_EXPERIENCE[role].tone}18` }]}><Ionicons name={ROLE_EXPERIENCE[role].icon} size={24} color={ROLE_EXPERIENCE[role].tone} /></View>
          <View style={styles.flex}>
            <Text style={styles.chooserRole}>{role}</Text>
            <Text style={styles.chooserMeta}>{ROLE_EXPERIENCE[role].subtitle}</Text>
          </View>
          {busy === role ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={20} color={colors.muted} />}
        </Pressable>
      ))}
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

interface Extras {
  overview: PlatformOverview | null;
  research: ResearchRow[] | null;
  apiLogs: ApiLogRow[] | null;
  activeClients: number;
  identificationsToday: number | null;
  staffCount: number | null;
}

const emptyExtras: Extras = { overview: null, research: null, apiLogs: null, activeClients: 0, identificationsToday: null, staffCount: null };

/** Aggregates that are not part of the scoped record snapshot (each call is authorised server-side). */
function useDashboardExtras(role: Role | null, userId: string | null, orgId: string | null) {
  const fetchExtras = useCallback(async (): Promise<Extras> => {
    const next: Extras = { ...emptyExtras };
    if (!role || !userId) return next;
    if (role === 'Super Administrator') {
      const { data, error } = await supabase.rpc('platform_overview');
      if (error) throw error;
      next.overview = data as PlatformOverview;
    }
    if (role === 'Researcher') {
      const { data, error } = await supabase.rpc('research_dataset');
      if (error) throw error;
      next.research = ((data ?? []) as ResearchRow[]).map((row) => ({ ...row, quality_score: Number(row.quality_score) }));
    }
    if (role === 'API Administrator') {
      const [logs, clients] = await Promise.all([
        supabase.from('api_request_logs').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('api_clients').select('id', { count: 'exact', head: true }).eq('status', 'Active'),
      ]);
      if (logs.error) throw logs.error;
      if (clients.error) throw clients.error;
      next.apiLogs = (logs.data ?? []) as ApiLogRow[];
      next.activeClients = clients.count ?? 0;
    }
    if (role === 'AI Technician' || role === 'Livestock Inspector' || role === 'Government Officer') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { count, error } = await supabase.from('audit_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('action', 'biometric.identify').eq('outcome', 'success').gte('created_at', start.toISOString());
      if (error) throw error;
      next.identificationsToday = count ?? 0;
    }
    if (role === 'Organisation Administrator' && orgId) {
      const { count, error } = await supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('organisation_id', orgId).in('role', ['Field Worker', 'AI Technician', 'Veterinarian', 'Farm Manager']);
      if (error) throw error;
      next.staffCount = count ?? 0;
    }
    return next;
  }, [orgId, role, userId]);
  return useAsyncResource(fetchExtras, 'Some dashboard figures could not be loaded.');
}

const TONES: Record<DashCard['tone'], { fg: string; bg: string }> = {
  green: { fg: colors.primaryDark, bg: colors.primaryLight },
  blue: { fg: colors.blue, bg: colors.blueLight },
  amber: { fg: colors.warning, bg: colors.warningLight },
  red: { fg: colors.danger, bg: colors.dangerLight },
  slate: { fg: '#475569', bg: colors.slateLight },
  violet: { fg: '#7C3AED', bg: '#EDE9FE' },
};

function Dashboard() {
  const session = useSession();
  const { animals, records, pendingCount, refreshing } = useBovineData();
  const policies = useBovineStore((state) => state.policyRows);
  const requests = useBovineStore((state) => state.requestRows);
  const notifications = useBovineStore((state) => state.notifications);
  const language = useAppStore((state) => state.language);
  const trials = useAppStore((state) => state.validationTrials);
  const wide = useIsWide();
  const role = session.role as Role;
  const experience = ROLE_EXPERIENCE[role];
  const extrasResource = useDashboardExtras(role, session.userId, session.scope?.organisation_id ?? null);
  const extras = extrasResource.data ?? emptyExtras;
  const reloadExtras = extrasResource.reload;

  const cards = useMemo(
    () =>
      buildDashboard({
        role,
        userId: session.userId ?? '',
        animals,
        records,
        policies,
        requests,
        notifications,
        pendingSync: pendingCount,
        farmCount: session.scope?.farm_ids.length ?? 0,
        overview: extras.overview,
        research: extras.research,
        apiLogs: extras.apiLogs,
        activeClients: extras.activeClients,
        myIdentificationsToday: extras.identificationsToday,
        staffCount: extras.staffCount,
        validationTrials: trials,
      }).filter((card) => canOpen(card.to, role, session.permissions) || card.to === 'notifications'),
    [animals, extras, notifications, pendingCount, policies, records, requests, role, session.permissions, session.scope, session.userId, trials]
  );
  const actions = useMemo(() => experience.actions.filter((action) => canOpen(action.to, role, session.permissions)), [experience.actions, role, session.permissions]);
  const alerts = useMemo(() => notifications.filter((item) => !item.read).slice(0, 3), [notifications]);
  const recent = useMemo(() => animals.filter((animal) => animal.approval_status !== 'Draft').slice(0, 3), [animals]);
  const farmer = role === 'Farmer';
  const showAnimalOverview = animals.length > 0 && canOpen('records', role, session.permissions);
  const openSpecies = useCallback((value: 'All' | AnimalCategory) => {
    router.push({ pathname: '/(tabs)/records', params: value === 'All' ? {} : { species: value } });
  }, []);

  const onRefresh = useCallback(() => {
    void reloadExtras();
    void loadBovineData();
  }, [reloadExtras]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={[styles.hero, { backgroundColor: experience.tone }]}>
        <View style={styles.heroIcon}><Ionicons name={experience.icon} size={26} color={colors.surface} /></View>
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>{experience.title}</Text>
          <Text style={styles.heroSubtitle}>{session.name} · {experience.subtitle}</Text>
        </View>
      </View>

      {role === 'Super Administrator' ? (
        <Pressable accessibilityRole="button" onPress={() => go('security')} style={[styles.privBanner, session.privileged && styles.privBannerOn]}>
          <Ionicons name={session.privileged ? 'lock-open-outline' : 'lock-closed-outline'} size={20} color={session.privileged ? colors.danger : colors.text} />
          <Text style={styles.privText}>{session.privileged ? `Privileged access active until ${new Date(session.privilegedUntil ?? '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Every access is audited.` : 'Identifiable animal and biometric records are hidden. Start an audited, justified privileged session to view them.'}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ) : null}

      {extrasResource.error ? (
        <View style={styles.inlineError}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text selectable style={styles.inlineErrorText}>{extrasResource.error}</Text>
          <Pressable accessibilityRole="button" onPress={onRefresh} hitSlop={8}><Text style={styles.retry}>Retry</Text></Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{tr(language, 'overview')}</Text>
      {showAnimalOverview ? <AnimalOverview animals={animals} category="All" onCategory={openSpecies} /> : null}
      <View style={styles.grid}>
        {cards.map((card) => (
          <Pressable key={card.label} accessibilityRole="button" accessibilityLabel={`${card.label}: ${card.value}`} onPress={() => go(card.to)} style={({ pressed }) => [styles.statCard, wide ? styles.statCardWide : styles.statCardNarrow, farmer && styles.statCardFarmer, pressed && styles.pressed]}>
            <View style={[styles.statIcon, { backgroundColor: TONES[card.tone].bg }]}><Ionicons name={card.icon} size={farmer ? 22 : 18} color={TONES[card.tone].fg} /></View>
            <Text selectable style={[styles.statValue, farmer && styles.statValueFarmer]}>{extrasResource.loading && card.value === '—' ? '…' : card.value}</Text>
            <Text style={styles.statLabel}>{card.label}</Text>
            {card.hint ? <Text style={styles.statHint}>{card.hint}</Text> : null}
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>{tr(language, 'quickActions')}</Text>
      <View style={styles.actions}>
        {actions.map((action, index) => (
          <PrimaryButton key={action.label} label={action.label} icon={action.icon} onPress={() => go(action.to)} variant={index === 0 ? 'primary' : 'outline'} style={[styles.actionButton, wide && styles.actionButtonWide]} />
        ))}
      </View>

      <Text style={styles.sectionTitle}>Biometric tools</Text>
      <View style={styles.actions}>
        {canOpen('verify', role, session.permissions) ? <PrimaryButton label="VERIFY ANIMAL (1:1)" icon="shield-checkmark-outline" variant="soft" onPress={() => go('verify')} style={[styles.actionButton, wide && styles.actionButtonWide]} /> : null}
        {canOpen('analytics', role, session.permissions) ? <PrimaryButton label="SCAN ANALYTICS · FAR/FRR · FPIR/FNIR" icon="pulse-outline" variant="soft" onPress={() => go('analytics')} style={[styles.actionButton, wide && styles.actionButtonWide]} /> : null}
        {canOpen('performance', role, session.permissions) ? <PrimaryButton label="MODEL PERFORMANCE & THRESHOLDS" icon="analytics-outline" variant="soft" onPress={() => go('performance')} style={[styles.actionButton, wide && styles.actionButtonWide]} /> : null}
      </View>

      {alerts.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>{tr(language, 'alerts')}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/notifications')} hitSlop={8}><Text style={styles.retry}>{tr(language, 'seeAll')}</Text></Pressable>
          </View>
          <Card style={styles.alertCard}>
            {alerts.map((alert) => (
              <Pressable key={alert.id} accessibilityRole="button" onPress={() => router.push('/notifications')} style={styles.alertRow}>
                <View style={[styles.alertDot, alert.type === 'alert' && styles.alertDotRed]} />
                <View style={styles.flex}>
                  <Text style={styles.alertTitle}>{alert.title}</Text>
                  <Text style={styles.alertMessage} numberOfLines={2}>{alert.message}</Text>
                </View>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {recent.length > 0 && canOpen('records', role, session.permissions) ? (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>{farmer ? tr(language, 'myAnimals') : tr(language, 'recentActivity')}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)/records')} hitSlop={8}><Text style={styles.retry}>{tr(language, 'seeAll')}</Text></Pressable>
          </View>
          {recent.map((animal) => (
            <Pressable key={animal.id} accessibilityRole="button" onPress={() => router.push(`/animal/${animal.moozzle_id}`)} style={({ pressed }) => [styles.animalRow, pressed && styles.pressed]}>
              <AnimalPhoto animal={animal} size={52} />
              <View style={styles.flex}>
                <Text selectable style={styles.tagPrimary} numberOfLines={1}>{tagLabel(animal.tag_id)}</Text>
                <Text style={styles.animalMeta}>{formatMoozzleId(animal.moozzle_id)} · {animal.breed} {animal.animal_type}{animal.farm_name || animal.village ? ` · ${animal.farm_name || animal.village}` : ''}</Text>
              </View>
              <Pill label={animal.approval_status} tone={animal.approval_status === 'Approved' ? 'green' : animal.approval_status === 'Retired' ? 'slate' : 'amber'} />
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tagPrimary: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18, letterSpacing: 0.6 },
  tagSecondary: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12, fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  hero: { borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 20, lineHeight: 25 },
  heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontFamily: Fonts.medium, fontSize: 13, marginTop: 3 },
  privBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14 },
  privBannerOn: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  privText: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerLight, borderRadius: 12, padding: 12 },
  inlineErrorText: { flex: 1, color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  retry: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 14 },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18, marginTop: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6, minHeight: 116, boxShadow: '0 3px 10px rgba(15, 23, 42, 0.05)' },
  statCardNarrow: { flexBasis: '47%', flexGrow: 1 },
  statCardWide: { flexBasis: '23%', flexGrow: 1 },
  statCardFarmer: { minHeight: 132 },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24, fontVariant: ['tabular-nums'] },
  statValueFarmer: { fontSize: 30 },
  statLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12, lineHeight: 16 },
  statHint: { color: '#94A3B8', fontFamily: Fonts.regular, fontSize: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionButton: { flexBasis: '100%', minHeight: 56 },
  actionButtonWide: { flexBasis: '48%', flexGrow: 1 },
  alertCard: { gap: 12, padding: 14 },
  alertRow: { flexDirection: 'row', gap: 10, minHeight: 44 },
  alertDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.warning, marginTop: 5 },
  alertDotRed: { backgroundColor: colors.danger },
  alertTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  alertMessage: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, marginTop: 2 },
  animalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 10 },
  animalId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  animalMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
  pressed: { opacity: 0.85 },
  chooserPage: { flex: 1, backgroundColor: colors.background },
  chooserContent: { padding: 24, paddingTop: 64, gap: 12, alignItems: 'stretch', maxWidth: 560, width: '100%', alignSelf: 'center' },
  chooserTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 28, marginTop: 12 },
  chooserSubtitle: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 15, marginBottom: 6 },
  chooserRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  chooserIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chooserRole: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  chooserMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, marginTop: 2 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
});
