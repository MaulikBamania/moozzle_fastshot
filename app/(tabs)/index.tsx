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
  Pill,
  SectionTitle,
  StorageGate,
  tr,
} from '@/components/moozzle-ui';
import { useAppStore } from '@/store/useAppStore';
import type { Animal, Language } from '@/store/types';
import { Fonts } from '@/constants/Typography';

export default function HomeScreen() {
  return (
    <StorageGate>
      <HomeContent />
    </StorageGate>
  );
}

function HomeContent() {
  const animals = useAppStore((state) => state.animals);
  const language = useAppStore((state) => state.language);
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
  const openRecentRecords = useCallback(() => router.replace('/(tabs)/records' as never), []);
  const openAnimal = useCallback((id: string) => router.push(`/animal/${id}`), []);

  return (
    <AppScreen>
      <View style={styles.screenBody}>
        <AppHeader language={language} onLanguageChange={handleLanguageChange} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          style={styles.homeScroll}
          contentContainerStyle={styles.homeContent}
        >
          <Card style={styles.statsCard}>
            <View style={styles.statsTop}>
              <View style={styles.statsMain}>
                <View style={styles.metricLabelRow}>
                  <Text style={styles.metricLabel}>Registered Bovines:</Text>
                  <Pill label="Demo Dataset" />
                </View>
                <Text selectable style={styles.metricValue}>{animals.length}</Text>
                <Text style={styles.metricSupporting}>2,822 central archive demo records</Text>
              </View>
              <View style={styles.speciesGrid}>
                <SpeciesMetric species="Cattle" label="Cattle" value={cattleCount} color={colors.primary} />
                <SpeciesMetric species="Buffalo" label="Buffalo" value={buffaloCount} color={colors.blue} />
              </View>
            </View>
            <View style={styles.syncBanner}>
              <Ionicons name="sync-outline" size={22} color={colors.warning} />
              <Text style={styles.syncText}>0 Pending Offline Sync</Text>
            </View>
          </Card>

          <View style={styles.actionGrid}>
            <ActionTile icon="camera" title={tr(language, 'register')} description="Enrol new cattle/buffalo with 3-5 muzzle scans." background={colors.primary} lightText onPress={openRegister} />
            <ActionTile icon="scan-outline" title={tr(language, 'identifyAnimal')} description="Scan muzzle to find 12-digit ID (1:N Search)." background={colors.blue} lightText onPress={openIdentify} />
            <ActionTile icon="document-text-outline" title={tr(language, 'animalRecords')} description="Browse 20+ demo animals, health & AI records." background={colors.surface} onPress={openRecords} />
            <ActionTile icon="shield-checkmark" title={tr(language, 'verifyAnimal')} description="1:1 Verification against known MOOZZLE ID." background="#2F8B59" lightText onPress={openVerify} />
          </View>

          <View style={styles.tipBanner}>
            <View style={styles.tipIcon}><Ionicons name="bulb-outline" size={27} color={colors.primary} /></View>
            <Text style={styles.tipText}><Text style={styles.tipStrong}>{tr(language, 'fieldTip')}: </Text>Wipe the animal&apos;s muzzle clean and keep steady lighting before scanning.</Text>
          </View>

          <SectionTitle title="Recent Identifications" action="View All" onAction={openRecentRecords} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentScroll} contentContainerStyle={styles.recentContent}>
            {recentAnimals.map((animal) => <RecentAnimalCard key={animal.moozzle_id} animal={animal} onPress={() => openAnimal(animal.moozzle_id)} />)}
          </ScrollView>
          <View style={styles.carouselDots}>
            <View style={[styles.carouselDot, styles.carouselDotActive]} /><View style={styles.carouselDot} /><View style={styles.carouselDot} />
          </View>
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

function ActionTile({ icon, title, description, background, lightText = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; description: string; background: string; lightText?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionTile, { backgroundColor: background }, pressed && styles.tilePressed]}>
      <View style={[styles.actionIcon, lightText ? styles.actionIconLight : styles.actionIconDark]}><Ionicons name={icon} size={28} color={lightText ? colors.primary : colors.surface} /></View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, lightText && styles.actionLightText]}>{title}</Text>
        <Text style={[styles.actionDescription, lightText && styles.actionLightText]}>{description}</Text>
      </View>
      <View style={styles.actionChevron}><Ionicons name="chevron-forward" size={28} color={lightText ? colors.surface : '#7890A4'} /></View>
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
        <View style={styles.enrolledRow}><Ionicons name="checkmark-circle" size={17} color={colors.accent} /><Text style={styles.enrolledText}>{animal.biometric_status}</Text><Ionicons name="chevron-forward" size={20} color={colors.muted} /></View>
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
  homeContent: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 16 },
  statsCard: { padding: 14, backgroundColor: '#FBFFFC', borderColor: '#D6E9DE' },
  statsTop: { flexDirection: 'row', minHeight: 100 },
  statsMain: { flex: 1, gap: 4 },
  metricLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  metricLabel: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18 },
  metricValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 48, lineHeight: 54, fontVariant: ['tabular-nums'] },
  metricSupporting: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 10 },
  speciesGrid: { flex: 0.95, flexDirection: 'row', marginLeft: 9, borderLeftWidth: 1, borderLeftColor: colors.border },
  speciesMetric: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, borderRightWidth: 1, borderRightColor: '#E8EEF1' },
  speciesLabel: { color: '#526176', fontFamily: Fonts.medium, fontSize: 13 },
  speciesValue: { fontFamily: Fonts.bold, fontSize: 23, fontVariant: ['tabular-nums'] },
  syncBanner: { backgroundColor: colors.warningLight, borderRadius: 12, minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, marginTop: 8 },
  syncText: { color: colors.warning, fontFamily: Fonts.semiBold, fontSize: 15 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  actionTile: { width: '47.7%', minHeight: 126, borderRadius: 14, padding: 15, position: 'relative', flexDirection: 'column', alignItems: 'flex-start', shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  actionIcon: { width: 44, height: 44, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  actionIconLight: { backgroundColor: colors.surface },
  actionIconDark: { backgroundColor: '#0F2D4A' },
  actionCopy: { width: '100%', gap: 7, paddingTop: 10, paddingRight: 4 },
  actionChevron: { position: 'absolute', top: 18, right: 15 },
  actionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  actionDescription: { color: '#526A84', fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  actionLightText: { color: colors.surface },
  tilePressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  tipBanner: { minHeight: 78, borderRadius: 14, backgroundColor: '#E7F5EE', paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  tipIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, color: '#3A526D', fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  tipStrong: { color: colors.primary, fontFamily: Fonts.bold },
  recentScroll: { marginHorizontal: -2 },
  recentContent: { gap: 10, paddingHorizontal: 2 },
  recentCard: { width: 182, overflow: 'hidden', borderRadius: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  recentPhotoWrap: { height: 108, position: 'relative', backgroundColor: colors.primaryLight },
  recentPhoto: { width: '100%', height: 108 },
  typeTag: { position: 'absolute', top: 7, right: 7, backgroundColor: colors.primaryLight, borderRadius: 13, paddingHorizontal: 9, paddingVertical: 5 },
  typeTagBlue: { backgroundColor: colors.blueLight },
  typeTagText: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 11 },
  typeTagTextBlue: { color: colors.blue },
  recentInfo: { padding: 10, gap: 5 },
  recentName: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  recentId: { color: '#526A84', fontFamily: Fonts.medium, fontSize: 12, fontVariant: ['tabular-nums'] },
  enrolledRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 4 },
  enrolledText: { flex: 1, color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 11 },
  carouselDots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingVertical: 2 },
  carouselDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#CBD5E1' },
  carouselDotActive: { backgroundColor: colors.primary },
});
