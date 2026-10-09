import { FontAwesome6, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AnimalPhoto,
  AppHeader,
  AppScreen,
  BottomNav,
  Card,
  colors,
  BiometricScanIcon,
  Pill,
  SectionTitle,
  DataGate,
  PrimaryButton,
  tr,
} from '@/components/moozzle-ui';
import { useAppStore } from '@/store/useAppStore';
import { useBovineData } from '@/store/useBovineStore';
import { useIsOnline } from '@/store/useConnectivity';
import type { Animal, Language } from '@/store/types';
import { Fonts } from '@/constants/Typography';

export default function HomeScreen() {
  return (
    <DataGate>
      <HomeContent />
    </DataGate>
  );
}

function HomeContent() {
  const { animals, pendingCount, error: dataError } = useBovineData();
  const language = useAppStore((state) => state.language);
  const online = useIsOnline();
  const setLanguage = useAppStore((state) => state.setLanguage);
  const recentAnimals = useMemo(() => animals.slice(0, 3), [animals]);
  const cattleCount = useMemo(() => animals.filter((item) => item.animal_type === 'Cattle').length, [animals]);
  const buffaloCount = useMemo(() => animals.filter((item) => item.animal_type === 'Buffalo').length, [animals]);

  const handleLanguageChange = useCallback((value: Language) => {
    setLanguage(value);
  }, [setLanguage]);
  const openRegister = useCallback(() => router.push('/register'), []);
  const openIdentify = useCallback(() => router.replace('/(tabs)/identify' as never), []);
  const openRecords = useCallback(() => router.replace('/(tabs)/records' as never), []);
  const openVerify = useCallback(() => router.replace('/(tabs)/verify' as never), []);
  const openSync = useCallback(() => router.push('/sync'), []);
  const openPerformance = useCallback(() => router.push('/performance'), []);
  const openApiDocs = useCallback(() => router.push('/api-docs'), []);
  const openAbout = useCallback(() => router.push('/about'), []);
  const openRecentRecords = useCallback(() => router.replace('/(tabs)/records' as never), []);
  const openAnimal = useCallback((id: string) => router.push(`/animal/${id}`), []);

  return (
    <AppScreen>
      <View style={styles.screenBody}>
        <AppHeader language={language} onLanguageChange={handleLanguageChange} offline={!online} onNetworkPress={openSync} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          style={styles.homeScroll}
          contentContainerStyle={styles.homeContent}
        >
          <Card style={styles.statsCard}>
            <View style={styles.metricLabelRow}>
              <Text style={styles.metricLabel}>Registered Bovines:</Text>
              <Pill label={online ? 'Cloud Archive' : 'Offline'} tone={online ? 'green' : 'amber'} />
            </View>
            <View style={styles.statsTop}>
              <View style={styles.statsMain}>
                <Text selectable style={styles.metricValue}>{animals.length}</Text>
                <Text style={styles.metricSupporting}>{dataError ? 'Showing last loaded records' : 'Enrolled under your account'}</Text>
              </View>
              <View style={styles.speciesGrid}>
                <SpeciesMetric species="Cattle" label="Cattle" value={cattleCount} color={colors.primary} />
                <SpeciesMetric species="Buffalo" label="Buffalo" value={buffaloCount} color={colors.blue} />
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={openSync} style={({ pressed }) => [styles.syncBanner, pressed && styles.tilePressed]}>
              <Ionicons name="sync-outline" size={22} color={colors.warning} />
              <Text style={styles.syncText}>{pendingCount > 0 ? `${pendingCount} Pending Offline Sync` : 'All records synced'}</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.warning} />
            </Pressable>
          </Card>

          <View style={styles.actionGrid}>
            <ActionTile icon="camera" title={tr(language, 'register')} description="Enrol new cattle/buffalo with 3-5 muzzle scans." background={colors.primary} lightText onPress={openRegister} />
            <ActionTile icon="biometric-scan" title={tr(language, 'identifyAnimal')} description="Scan muzzle to find 12-digit ID (1:N Search)." background={colors.blue} lightText onPress={openIdentify} />
            <ActionTile icon="document-text-outline" title={tr(language, 'animalRecords')} description="Browse your enrolled bovines, health & AI records." background={colors.surface} onPress={openRecords} />
            <ActionTile icon="sync-outline" title="SYNC DATA" description="Upload queued records and muzzle images securely." background={colors.warning} lightText onPress={openSync} />
          </View>

          <SectionTitle title="Field Console" />
          <View style={styles.quickGrid}>
            <QuickLink icon="shield-checkmark-outline" title={tr(language, 'verifyAnimal')} detail="1:1 biometric verification" tone="green" onPress={openVerify} />
            <QuickLink icon="analytics-outline" title="PERFORMANCE" detail="Benchmarks and field trials" tone="blue" onPress={openPerformance} />
            <QuickLink icon="code-slash-outline" title="API CONSOLE" detail="Inspect REST endpoints" tone="blue" onPress={openApiDocs} />
            <QuickLink icon="information-circle-outline" title="ABOUT MOOZZLE" detail="Architecture and safeguards" tone="green" onPress={openAbout} />
          </View>

          <View style={styles.tipBanner}>
            <View style={styles.tipIcon}><Ionicons name="bulb-outline" size={27} color={colors.primary} /></View>
            <Text style={styles.tipText}><Text style={styles.tipStrong}>{tr(language, 'fieldTip')}: </Text>Wipe the animal&apos;s muzzle clean and keep steady lighting before scanning.</Text>
          </View>

          <SectionTitle title="Recent Identifications" action="View All" onAction={openRecentRecords} />
          {recentAnimals.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentScroll} contentContainerStyle={styles.recentContent}>
              {recentAnimals.map((animal) => <RecentAnimalCard key={animal.id} animal={animal} onPress={() => openAnimal(animal.moozzle_id)} />)}
            </ScrollView>
          ) : (
            <View style={styles.emptyRecent}>
              <View style={styles.emptyIcon}><MaterialCommunityIcons name="cow" size={26} color={colors.primary} /></View>
              <Text style={styles.emptyTitle}>No bovines enrolled yet</Text>
              <Text style={styles.emptyText}>Register your first animal to create its permanent 12-digit MOOZZLE ID.</Text>
              <PrimaryButton label="Enrol First Bovine" icon="add" onPress={openRegister} />
            </View>
          )}
        </ScrollView>
        <BottomNav active="home" />
      </View>
    </AppScreen>
  );
}

function SpeciesMetric({ species, label, value, color }: { species: Animal['animal_type']; label: string; value: number; color: string }) {
  return (
    <View style={styles.speciesMetric}>
      {species === 'Cattle' ? <MaterialCommunityIcons name="cow" size={29} color={color} /> : <FontAwesome6 name="cow" size={27} color={color} />}
      <Text style={styles.speciesLabel}>{label}</Text>
      <Text style={[styles.speciesValue, { color }]}>{value}</Text>
    </View>
  );
}

function ActionTile({ icon, title, description, background, lightText = false, onPress }: { icon: keyof typeof Ionicons.glyphMap | 'biometric-scan'; title: string; description: string; background: string; lightText?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionTile, { backgroundColor: background }, pressed && styles.tilePressed]}>
      <View style={[styles.actionIcon, lightText ? styles.actionIconLight : styles.actionIconDark]}>{icon === 'biometric-scan' ? <BiometricScanIcon size={29} color={lightText ? colors.primary : colors.surface} /> : <Ionicons name={icon} size={28} color={lightText ? colors.primary : colors.surface} />}</View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, lightText && styles.actionLightText]}>{title}</Text>
        <Text numberOfLines={2} style={[styles.actionDescription, lightText && styles.actionLightText]}>{description}</Text>
      </View>
      <View style={styles.actionChevron}><Ionicons name="chevron-forward" size={28} color={lightText ? colors.surface : '#7890A4'} /></View>
    </Pressable>
  );
}

function QuickLink({ icon, title, detail, tone, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; tone: 'green' | 'blue'; onPress: () => void }) {
  const accent = tone === 'blue' ? colors.blue : colors.primary;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.quickLink, pressed && styles.tilePressed]}>
      <View style={[styles.quickIcon, { backgroundColor: tone === 'blue' ? colors.blueLight : colors.primaryLight }]}><Ionicons name={icon} size={20} color={accent} /></View>
      <View style={styles.quickCopy}><Text adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} style={styles.quickTitle}>{title}</Text><Text numberOfLines={2} style={styles.quickDetail}>{detail}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function RecentAnimalCard({ animal, onPress }: { animal: Animal; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.recentCard, pressed && styles.tilePressed]}>
      <View style={styles.recentPhotoWrap}>
        <AnimalPhoto animal={animal} size={108} rounded={false} style={styles.recentPhoto} />
        <View style={[styles.typeTag, animal.animal_type === 'Buffalo' && styles.typeTagBlue]}><Text style={[styles.typeTagText, animal.animal_type === 'Buffalo' && styles.typeTagTextBlue]}>{animal.animal_type}</Text></View>
      </View>
      <View style={styles.recentInfo}>
        <Text numberOfLines={1} style={styles.recentName}>{animal.breed} {animal.animal_type === 'Buffalo' ? 'Buffalo' : 'Cow'}</Text>
        <Text selectable style={styles.recentId}>{formatRecentId(animal.moozzle_id)}</Text>
        <View style={styles.enrolledRow}><Ionicons name="checkmark-circle" size={17} color={colors.accent} /><Text style={styles.enrolledText}>{animal.pending_sync ? 'Queued' : animal.biometric_status}</Text><Ionicons name="chevron-forward" size={20} color={colors.muted} /></View>
      </View>
    </Pressable>
  );
}

function formatRecentId(id: string) {
  return id.replace(/(\d{4})(\d{4})(\d{4})/, '$1  $2  $3');
}

const styles = StyleSheet.create({
  screenBody: { flex: 1 },
  homeScroll: { flex: 1 },
  homeContent: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 112, gap: 10 },
  statsCard: { padding: 8, backgroundColor: '#FBFFFC', borderColor: '#D6E9DE' },
  statsTop: { flexDirection: 'row', minHeight: 52 },
  statsMain: { flex: 0.9, justifyContent: 'center', gap: 0 },
  metricLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'nowrap' },
  metricLabel: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  metricValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 38, lineHeight: 40, fontVariant: ['tabular-nums'] },
  metricSupporting: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 8, lineHeight: 9 },
  speciesGrid: { flex: 1.05, flexDirection: 'row', marginLeft: 9, borderLeftWidth: 1, borderLeftColor: colors.border },
  speciesMetric: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 0, borderRightWidth: 1, borderRightColor: '#E8EEF1' },
  speciesLabel: { color: '#526176', fontFamily: Fonts.medium, fontSize: 13 },
  speciesValue: { fontFamily: Fonts.bold, fontSize: 21, lineHeight: 23, fontVariant: ['tabular-nums'] },
  syncBanner: { backgroundColor: colors.warningLight, borderRadius: 12, minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, marginTop: 5 },
  syncText: { color: colors.warning, fontFamily: Fonts.semiBold, fontSize: 13 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickLink: { width: '48%', minHeight: 78, borderRadius: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  quickCopy: { flex: 1, minWidth: 0, gap: 3 },
  quickTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 10, lineHeight: 13, letterSpacing: -0.15, flexShrink: 1 },
  quickDetail: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 9.5, lineHeight: 13, flexShrink: 1 },
  actionTile: { width: '47.5%', height: 118, borderRadius: 14, padding: 10, position: 'relative', flexDirection: 'column', alignItems: 'flex-start', shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  actionIcon: { width: 36, height: 36, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actionIconLight: { backgroundColor: colors.surface },
  actionIconDark: { backgroundColor: '#0F2D4A' },
  actionCopy: { width: '100%', gap: 3, paddingTop: 4, paddingRight: 4 },
  actionChevron: { position: 'absolute', top: 14, right: 12 },
  actionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, lineHeight: 16 },
  actionDescription: { color: '#526A84', fontFamily: Fonts.regular, fontSize: 10.5, lineHeight: 15 },
  actionLightText: { color: colors.surface },
  tilePressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  tipBanner: { minHeight: 52, borderRadius: 14, backgroundColor: '#E7F5EE', paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tipIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, color: '#3A526D', fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  tipStrong: { color: colors.primary, fontFamily: Fonts.bold },
  recentScroll: { flexGrow: 0, marginHorizontal: -2 },
  recentContent: { gap: 10, paddingHorizontal: 2 },
  recentCard: { width: 110, overflow: 'hidden', borderRadius: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  recentPhotoWrap: { height: 56, position: 'relative', backgroundColor: colors.primaryLight },
  recentPhoto: { width: '100%', height: 56 },
  typeTag: { position: 'absolute', top: 4, right: 4, backgroundColor: colors.primaryLight, borderRadius: 13, paddingHorizontal: 7, paddingVertical: 4 },
  typeTagBlue: { backgroundColor: colors.blueLight },
  typeTagText: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 10 },
  typeTagTextBlue: { color: colors.blue },
  recentInfo: { padding: 6, gap: 3 },
  recentName: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, lineHeight: 15 },
  recentId: { color: '#526A84', fontFamily: Fonts.medium, fontSize: 10, fontVariant: ['tabular-nums'] },
  enrolledRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 3 },
  enrolledText: { flex: 1, color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 10 },
  emptyRecent: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.surface, padding: 16, gap: 8, alignItems: 'center' },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  emptyText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 4 },
});
