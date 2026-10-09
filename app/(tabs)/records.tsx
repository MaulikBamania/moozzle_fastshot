import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  AnimalPhoto,
  AppScreen,
  BottomNav,
  colors,
  EmptyState,
  OptionChip,
  Pill,
  PrimaryButton,
  DataGate,
} from '@/components/moozzle-ui';
import { loadBovineData, useBovineData } from '@/store/useBovineStore';
import type { Animal } from '@/store/types';
import { Fonts } from '@/constants/Typography';

type Filter = 'All' | 'Cattle' | 'Buffalo' | 'Active' | 'Retired';

export default function RecordsScreen() {
  return <DataGate><RecordsContent /></DataGate>;
}

function RecordsContent() {
  const { animals, error: dataError, refreshing } = useBovineData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const activeCount = useMemo(() => animals.filter((item) => item.current_status === 'Active').length, [animals]);
  const retiredCount = useMemo(() => animals.filter((item) => item.current_status === 'Retired').length, [animals]);
  const cattleCount = useMemo(() => animals.filter((item) => item.animal_type === 'Cattle').length, [animals]);
  const buffaloCount = useMemo(() => animals.filter((item) => item.animal_type === 'Buffalo').length, [animals]);
  const filteredAnimals = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return animals.filter((item) => {
      const matchesFilter = filter === 'All' || item.animal_type === filter || item.current_status === filter;
      const matchesQuery = !normalized || [item.moozzle_id, item.owner_name, item.village, item.breed, item.district].some((value) => value.toLowerCase().includes(normalized));
      return matchesFilter && matchesQuery;
    });
  }, [animals, filter, query]);
  const openAnimal = useCallback((animal: Animal) => router.push(`/animal/${animal.moozzle_id}`), []);
  const openRegister = useCallback(() => router.push('/register'), []);

  return (
    <AppScreen>
      <View style={styles.screenBody}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.content}>
          <View style={styles.headerRow}><View><Text style={styles.eyebrow}>CLOUD ARCHIVE</Text><Text style={styles.title}>Animal Records</Text></View><View style={styles.countBadge}><Text style={styles.countNumber}>{animals.length}</Text><Text style={styles.countLabel}>{animals.length === 1 ? 'bovine' : 'bovines'}</Text></View></View>
          <View style={styles.noteRow}>
            <Text style={styles.archiveNote}>{refreshing ? 'Refreshing from Supabase…' : `${animals.length} bovines enrolled under your account`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh records" onPress={() => void loadBovineData()} hitSlop={10} style={styles.refresh}>
              <Ionicons name="refresh" size={18} color={colors.primary} />
            </Pressable>
          </View>
          {dataError ? <View style={styles.errorBanner}><Ionicons name="cloud-offline-outline" size={17} color={colors.danger} /><Text selectable style={styles.errorText}>{dataError}</Text><Pressable accessibilityRole="button" onPress={() => void loadBovineData()} hitSlop={8}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
          <View style={styles.searchBox}><Ionicons name="search-outline" size={21} color={colors.muted} /><TextInput accessibilityLabel="Search animal records" value={query} onChangeText={setQuery} placeholder="Search ID, owner, village or breed" placeholderTextColor={colors.muted} style={styles.searchInput} /><Pressable accessibilityRole="button" onPress={() => setQuery('')} hitSlop={8}>{query.length > 0 && <Ionicons name="close-circle" size={19} color={colors.muted} />}</Pressable></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
            <FilterChip label={`All (${animals.length})`} selected={filter === 'All'} onPress={() => setFilter('All')} />
            <FilterChip label={`Cattle (${cattleCount})`} selected={filter === 'Cattle'} onPress={() => setFilter('Cattle')} />
            <FilterChip label={`Buffalo (${buffaloCount})`} selected={filter === 'Buffalo'} onPress={() => setFilter('Buffalo')} />
            <FilterChip label={`Active (${activeCount})`} selected={filter === 'Active'} onPress={() => setFilter('Active')} />
            <FilterChip label={`Retired (${retiredCount})`} selected={filter === 'Retired'} onPress={() => setFilter('Retired')} tone="red" />
          </ScrollView>
          <View style={styles.listHeader}><Text style={styles.listTitle}>{filteredAnimals.length} matching records</Text><Text style={styles.listHint}>Tap a card for services</Text></View>
          {animals.length === 0 ? (
            <View style={styles.firstRun}>
              <EmptyState title="No bovines enrolled yet" message="Enrol your first cattle or buffalo with a muzzle scan to start its permanent record." />
              <PrimaryButton label="Enrol First Bovine" icon="add" onPress={openRegister} />
            </View>
          ) : filteredAnimals.length > 0 ? filteredAnimals.map((animal) => <AnimalRow key={animal.id} animal={animal} onPress={() => openAnimal(animal)} />) : <EmptyState title="No animals found" message="Try a different ID, breed, owner, village, or filter." />}
        </ScrollView>
        <View style={styles.fabWrap}><PrimaryButton label="Register Animal" icon="add" onPress={openRegister} style={styles.fab} /></View>
        <BottomNav active="records" />
      </View>
    </AppScreen>
  );
}

function FilterChip({ label, selected, onPress, tone = 'green' }: { label: string; selected: boolean; onPress: () => void; tone?: 'green' | 'red' }) {
  return <OptionChip label={label} selected={selected} onPress={onPress} tone={tone} />;
}

function AnimalRow({ animal, onPress }: { animal: Animal; onPress: () => void }) {
  const retired = animal.current_status === 'Retired';
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.animalRow, pressed && styles.rowPressed]}><AnimalPhoto animal={animal} size={66} /><View style={styles.animalMain}><View style={styles.animalIdRow}><Text selectable style={styles.animalId}>{animal.moozzle_id.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}</Text><Pill label={retired ? 'Retired' : 'Enrolled'} tone={retired ? 'red' : 'green'} />{animal.pending_sync && <Pill label="Queued" tone="amber" />}</View><Text style={styles.animalSub}>{animal.breed} · {animal.animal_type}</Text><Text style={styles.animalOwner}>{animal.owner_name} · {animal.village}</Text></View><Ionicons name="chevron-forward" size={22} color={colors.muted} /></Pressable>;
}

const styles = StyleSheet.create({
  screenBody: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 100, gap: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.1 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 29, marginTop: 4 },
  countBadge: { minWidth: 72, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center' },
  countNumber: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 20 },
  countLabel: { color: colors.primary, fontFamily: Fonts.medium, fontSize: 10 },
  archiveNote: { flex: 1, color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refresh: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, color: colors.danger, fontFamily: Fonts.medium, fontSize: 12 },
  retryText: { color: colors.danger, fontFamily: Fonts.bold, fontSize: 12 },
  firstRun: { gap: 4, paddingBottom: 10 },
  searchBox: { minHeight: 50, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, color: colors.text, fontFamily: Fonts.regular, fontSize: 14, minHeight: 48 },
  filterScroll: { flexGrow: 0 },
  filterContent: { gap: 8, paddingRight: 10 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 },
  listTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  listHint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  animalRow: { minHeight: 91, padding: 11, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#0F172A', shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  rowPressed: { opacity: 0.8 },
  animalMain: { flex: 1, gap: 4 },
  animalIdRow: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  animalId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, fontVariant: ['tabular-nums'] },
  animalSub: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 12 },
  animalOwner: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11 },
  fabWrap: { position: 'absolute', right: 14, bottom: 82 },
  fab: { minHeight: 48, borderRadius: 24, paddingHorizontal: 16, shadowColor: '#0F172A', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
});
