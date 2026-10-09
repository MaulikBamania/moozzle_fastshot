import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { go, TabShell } from '@/components/app-chrome';
import { AnimalPhoto, approvalTone, colors, DataGate, EmptyState, formatMoozzleId, OptionChip, Pill, PrimaryButton, TextField, tr } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { allows } from '@/lib/rbac';
import { useAppStore } from '@/store/useAppStore';
import { loadBovineData, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';
import type { Animal } from '@/store/types';

type SpeciesFilter = 'All' | 'Cattle' | 'Buffalo';
type StatusFilter = 'All' | 'Active' | 'Pending' | 'Drafts' | 'Retired';

export default function RecordsScreen() {
  return (
    <DataGate>
      <TabShell active="records">
        <RecordsContent />
      </TabShell>
    </DataGate>
  );
}

function RecordsContent() {
  const session = useSession();
  const { animals, refreshing } = useBovineData();
  const policies = useBovineStore((state) => state.policyRows);
  const language = useAppStore((state) => state.language);
  const [query, setQuery] = useState('');
  const [species, setSpecies] = useState<SpeciesFilter>('All');
  const [status, setStatus] = useState<StatusFilter>('All');
  const [breed, setBreed] = useState('All');
  const canRegister = allows(session.permissions.register_animal);
  const role = session.role;
  const breeds = useMemo(() => ['All', ...Array.from(new Set(animals.map((animal) => animal.breed))).sort()], [animals]);
  const policyAnimals = useMemo(() => new Set(policies.map((policy) => policy.animal_id)), [policies]);

  const filtered = useMemo(() => {
    const q = query.replace(/\s/g, '').toLowerCase();
    return animals.filter((animal) => {
      if (species !== 'All' && animal.animal_type !== species) return false;
      if (breed !== 'All' && animal.breed !== breed) return false;
      if (status === 'Active' && (animal.current_status !== 'Active' || animal.approval_status === 'Draft')) return false;
      if (status === 'Pending' && animal.approval_status !== 'Submitted' && animal.approval_status !== 'Pending Review') return false;
      if (status === 'Drafts' && animal.approval_status !== 'Draft') return false;
      if (status === 'Retired' && animal.current_status !== 'Retired') return false;
      if (!q) return true;
      return [animal.moozzle_id, animal.breed, animal.farm_name, animal.village, animal.district].some((value) => value.replace(/\s/g, '').toLowerCase().includes(q));
    });
  }, [animals, breed, query, species, status]);

  const openAnimal = useCallback((animal: Animal) => router.push(`/animal/${animal.moozzle_id}`), []);
  const onRefresh = useCallback(() => void loadBovineData(), []);

  if (role === 'Researcher' || role === 'API Administrator') {
    return (
      <View style={styles.center}>
        <EmptyState title="No identifiable records for this role" message={role === 'Researcher' ? 'Researchers work with the de-identified dataset only.' : 'Integration administrators do not access animal records in the app.'} />
        <PrimaryButton label={role === 'Researcher' ? 'Open De-identified Dataset' : 'Open API Clients'} icon="arrow-forward" onPress={() => go(role === 'Researcher' ? 'research' : 'api')} />
      </View>
    );
  }

  const title = role === 'Farmer' ? tr(language, 'myAnimals') : role === 'Insurance Officer' ? 'Policy Animals' : role === 'Super Administrator' ? 'Animal Database' : 'Animal Directory';
  const scopeLine = role === 'Farmer' ? 'Animals linked to your verified account' : role === 'Insurance Officer' ? 'Animals on policies assigned to your company' : `Authorised scope: ${session.scopeLabel}`;

  return (
    <FlatList
      data={filtered}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{scopeLine} · {animals.length} record{animals.length === 1 ? '' : 's'}</Text>
            </View>
          </View>
          {role === 'Super Administrator' && !session.privileged ? (
            <Pressable accessibilityRole="button" onPress={() => go('security')} style={styles.lockBanner}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.text} />
              <Text style={styles.lockText}>Identifiable records are hidden until you start a justified, audited privileged session.</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
          <PrimaryButton label="+ Register Bovine" onPress={() => router.push('/register')} disabled={!canRegister} variant={canRegister ? 'primary' : 'soft'} />
          {!canRegister ? <Text style={styles.disabledNote}>Your role cannot register animals.</Text> : null}
          <TextField label="Search" value={query} onChangeText={setQuery} placeholder="MOOZZLE ID, breed, farm or village" autoCapitalize="none" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
            {(['All', 'Cattle', 'Buffalo'] as SpeciesFilter[]).map((item) => <OptionChip key={item} label={item} selected={species === item} onPress={() => setSpecies(item)} />)}
            <View style={styles.divider} />
            {(['All', 'Active', 'Pending', 'Drafts', 'Retired'] as StatusFilter[]).map((item) => <OptionChip key={`s-${item}`} label={item === 'All' ? 'Any status' : item} selected={status === item} onPress={() => setStatus(item)} tone="blue" />)}
          </ScrollView>
          {breeds.length > 2 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
              {breeds.map((item) => <OptionChip key={`b-${item}`} label={item === 'All' ? 'All breeds' : item} selected={breed === item} onPress={() => setBreed(item)} />)}
            </ScrollView>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title={animals.length === 0 ? 'No animals in your scope yet' : 'No matching animals'}
          message={animals.length === 0 ? (canRegister ? 'Register the first animal for your authorised scope.' : 'Animals appear here once they are linked to your role’s scope.') : 'Try a different search or filter.'}
        />
      }
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.breed} ${formatMoozzleId(item.moozzle_id)}`} onPress={() => openAnimal(item)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <AnimalPhoto animal={item} size={58} />
          <View style={styles.flex}>
            <Text selectable style={styles.rowId}>{formatMoozzleId(item.moozzle_id)}</Text>
            <Text style={styles.rowMeta}>{item.breed} {item.animal_type} · {item.sex} · {item.age_years} yrs</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>{item.farm_name || 'No farm'} · {item.village}{item.owner_visible && item.owner_name ? ` · ${item.owner_name}` : ''}</Text>
            <View style={styles.pills}>
              <Pill label={item.approval_status} tone={approvalTone(item.approval_status)} />
              {item.pending_sync ? <Pill label="Waiting to sync" tone="amber" /> : null}
              {item.duplicate_of ? <Pill label="Possible duplicate" tone="red" /> : null}
              {policyAnimals.has(item.id) ? <Pill label="Insured" tone="blue" /> : null}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  content: { padding: 16, gap: 10, paddingBottom: 32, maxWidth: 900, width: '100%', alignSelf: 'center' },
  header: { gap: 12, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 26 },
  subtitle: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 13, marginTop: 2 },
  lockBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 },
  lockText: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  disabledNote: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: -6 },
  chipScroll: { flexGrow: 0 },
  chips: { gap: 8, paddingRight: 8, alignItems: 'center' },
  divider: { width: 1, height: 26, backgroundColor: colors.border, marginHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12 },
  rowId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  rowMeta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pressed: { opacity: 0.85 },
});
