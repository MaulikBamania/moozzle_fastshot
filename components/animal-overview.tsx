import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from '@/components/translated-text';
import { AnimalPhoto, approvalTone, colors, formatMoozzleId, Pill } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { tagLabel } from '@/lib/tag-id';
import { animalAgeText } from '@/lib/age';
import { ANIMAL_CATEGORIES, type AnimalCategory, animalCategory } from '@/lib/demographics';
import type { AgeGroup, Animal } from '@/store/types';

type Tone = 'green' | 'blue' | 'amber' | 'red' | 'slate';

interface OverviewStats {
  total: number;
  species: Record<AnimalCategory, number>;
  milk: number;
  dry: number;
  pregnant: number;
  dairy: number;
  submitted: number;
  approved: number;
}

export function computeOverview(animals: readonly Animal[]): OverviewStats {
  const species: Record<AnimalCategory, number> = { Cattle: 0, Buffalo: 0, Crossbred: 0, Bull: 0, Bullock: 0 };
  const stats: OverviewStats = { total: animals.length, species, milk: 0, dry: 0, pregnant: 0, dairy: 0, submitted: 0, approved: 0 };
  for (const animal of animals) {
    species[animalCategory(animal)] += 1;
    if (animal.production_status === 'MILK') stats.milk += 1;
    if (animal.production_status === 'DRY') stats.dry += 1;
    if (animal.pregnancy_status === 'PREGNANT') stats.pregnant += 1;
    if (animal.dairy_society_member === true) stats.dairy += 1;
    if (animal.approval_status === 'Submitted' || animal.approval_status === 'Pending Review') stats.submitted += 1;
    if (animal.approval_status === 'Approved') stats.approved += 1;
  }
  return stats;
}

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const SPECIES_STYLE: Record<AnimalCategory, { icon: IconName; tone: Tone }> = {
  Cattle: { icon: 'cow', tone: 'green' },
  Buffalo: { icon: 'cow', tone: 'slate' },
  Crossbred: { icon: 'dna', tone: 'blue' },
  Bull: { icon: 'gender-male', tone: 'red' },
  Bullock: { icon: 'tractor', tone: 'amber' },
};

function share(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';
}

/** Large KPI tile: tinted icon chip, bold figure and a clear label. */
function KpiTile({ icon, label, value, total, tone }: { icon: IconName; label: string; value: number; total: number; tone: Tone }) {
  const palette = TONES[tone];
  return (
    <View style={styles.kpi} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.kpiTop}>
        <View style={[styles.kpiIcon, { backgroundColor: palette.bg }]}>
          <MaterialCommunityIcons name={icon} size={22} color={palette.fg} />
        </View>
        <Text style={[styles.kpiShare, { color: palette.fg }]}>{share(value, total)}</Text>
      </View>
      <Text selectable style={styles.kpiValue}>{value}</Text>
      <Text numberOfLines={2} style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

/** Tappable species tile that opens the records list filtered to that species. */
function SpeciesTile({ species, value, selected, wide, onPress }: { species: AnimalCategory; value: number; selected: boolean; wide: boolean; onPress: (species: AnimalCategory) => void }) {
  const { icon, tone } = SPECIES_STYLE[species];
  const palette = TONES[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${species}: ${value}`}
      onPress={() => onPress(species)}
      style={wide ? styles.speciesCellWide : styles.speciesCell}
    >
      {({ pressed }) => (
        <View style={[styles.species, selected && styles.speciesSelected, pressed && styles.pressed]}>
          <View style={[styles.speciesIcon, { backgroundColor: palette.bg }]}>
            <MaterialCommunityIcons name={icon} size={24} color={palette.fg} />
          </View>
          <View style={styles.flex}>
            <Text selectable style={styles.speciesValue}>{value}</Text>
            <Text numberOfLines={1} style={styles.speciesLabel}>{species}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
        </View>
      )}
    </Pressable>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/** Demographic summary of every animal in the user's scope (unfiltered). */
export const AnimalOverview = memo(function AnimalOverview({ animals, category, onCategory }: { animals: readonly Animal[]; category: 'All' | AnimalCategory; onCategory: (value: 'All' | AnimalCategory) => void }) {
  const [open, setOpen] = useState(true);
  const stats = useMemo(() => computeOverview(animals), [animals]);
  const toggleSpecies = useCallback((item: AnimalCategory) => onCategory(category === item ? 'All' : item), [category, onCategory]);
  const lastIndex = ANIMAL_CATEGORIES.length - 1;
  const oddCount = ANIMAL_CATEGORIES.length % 2 === 1;

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Toggle animal overview" onPress={() => setOpen((value) => !value)}>
        {({ pressed }) => (
          <View style={[styles.hero, pressed && styles.pressed]}>
            <View style={styles.heroBadge}>
              <MaterialCommunityIcons name="paw" size={28} color={colors.surface} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.heroLabel}>Total Animals</Text>
              <Text selectable style={styles.heroValue}>{stats.total}</Text>
              <Text numberOfLines={2} style={styles.heroSubtitle}>Animals registered in your records</Text>
            </View>
            <View style={styles.toggle}>
              <Text style={styles.toggleText}>{open ? 'Hide' : 'Details'}</Text>
              <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
            </View>
          </View>
        )}
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Section icon="cow" title="Species">
            <Text style={styles.hint}>Tap a species to view its animals</Text>
            <View style={styles.speciesGrid}>
              {ANIMAL_CATEGORIES.map((item, index) => (
                <SpeciesTile key={item} species={item} value={stats.species[item]} selected={category === item} wide={oddCount && index === lastIndex} onPress={toggleSpecies} />
              ))}
            </View>
          </Section>

          <Section icon="water" title="Production">
            <View style={styles.kpiRow}>
              <KpiTile icon="water" label="Milk" value={stats.milk} total={stats.total} tone="blue" />
              <KpiTile icon="water-off" label="Dry" value={stats.dry} total={stats.total} tone="amber" />
            </View>
          </Section>

          <View style={styles.kpiRow}>
            <View style={styles.flex}>
              <Section icon="heart-pulse" title="Pregnancy">
                <KpiTile icon="heart-pulse" label="Pregnant" value={stats.pregnant} total={stats.total} tone="red" />
              </Section>
            </View>
            <View style={styles.flex}>
              <Section icon="office-building" title="Dairy Society">
                <KpiTile icon="office-building" label="Giving milk" value={stats.dairy} total={stats.total} tone="green" />
              </Section>
            </View>
          </View>

          <Section icon="shield-check" title="Verification">
            <View style={styles.kpiRow}>
              <KpiTile icon="clock-outline" label="Submitted" value={stats.submitted} total={stats.total} tone="amber" />
              <KpiTile icon="check-decagram" label="Approved" value={stats.approved} total={stats.total} tone="green" />
            </View>
          </Section>
        </View>
      ) : null}
    </View>
  );
});

const AGE_GROUP_LABEL: Record<AgeGroup, string> = { CALF: 'Calf', YOUNG: 'Young', ADULT: 'Adult' };

/** Animal list card showing the demographics captured at registration. */
export const AnimalDemographicCard = memo(function AnimalDemographicCard({ animal, insured, onPress }: { animal: Animal; insured: boolean; onPress: (animal: Animal) => void }) {
  const category = animalCategory(animal);
  const location = [animal.village, animal.district].filter(Boolean).join(', ');
  const showProduction = animal.production_status === 'MILK' || animal.production_status === 'DRY';
  const showPregnancy = animal.pregnancy_status === 'PREGNANT' || animal.pregnancy_status === 'NON-PREGNANT';

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open Tag ${tagLabel(animal.tag_id)} · ${animal.breed} ${formatMoozzleId(animal.moozzle_id)}`} onPress={() => onPress(animal)}>
      {({ pressed }) => (
        <View style={[styles.row, pressed && styles.pressed]}>
          <View style={styles.rowTop}>
            <AnimalPhoto animal={animal} size={64} />
            <View style={styles.flex}>
              <Text selectable style={styles.tagPrimary} numberOfLines={1}>{tagLabel(animal.tag_id)}</Text>
              <Text selectable style={styles.tagSecondary}>MOOZZLE {formatMoozzleId(animal.moozzle_id)}</Text>
              <View style={styles.tagRow}>
                <View style={styles.speciesTag}>
                  <Text numberOfLines={1} style={styles.speciesTagText}>{category}</Text>
                </View>
                <Text numberOfLines={1} style={styles.breedText}>{animal.breed}</Text>
              </View>
              <View style={styles.tagRow}>
                <Text style={styles.rowMeta}>{animal.sex} · {animalAgeText(animal, true)}</Text>
                {animal.age_group ? <Pill label={AGE_GROUP_LABEL[animal.age_group]} tone="slate" /> : null}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </View>

          {showProduction || showPregnancy || animal.dairy_society_member ? (
            <View style={styles.pills}>
              {showProduction ? <Pill label={animal.production_status === 'MILK' ? 'MILK' : 'DRY'} tone={animal.production_status === 'MILK' ? 'blue' : 'amber'} /> : null}
              {showPregnancy ? <Pill label={animal.pregnancy_status === 'PREGNANT' ? 'PREGNANT' : 'NON-PREGNANT'} tone={animal.pregnancy_status === 'PREGNANT' ? 'red' : 'slate'} /> : null}
              {animal.dairy_society_member ? <Pill label={animal.society_name ? `Dairy Society: ${animal.society_name}` : 'Dairy society member'} tone="green" /> : null}
            </View>
          ) : null}

          <View style={styles.ownerRow}>
            <Ionicons name="location-outline" size={14} color={colors.muted} />
            <Text numberOfLines={2} style={styles.ownerText}>
              {animal.owner_visible && animal.owner_name ? `${animal.owner_name} · ` : ''}{location || animal.farm_name || 'Location not recorded'}
            </Text>
          </View>

          <View style={styles.pills}>
            <Pill label={animal.approval_status} tone={approvalTone(animal.approval_status)} />
            {insured ? <Pill label="Insured" tone="blue" /> : null}
            {animal.pending_sync ? <Pill label="Waiting to sync" tone="amber" /> : null}
            {animal.duplicate_of ? <Pill label="Possible duplicate" tone="red" /> : null}
          </View>
        </View>
      )}
    </Pressable>
  );
});

const TONES: Record<Tone, { fg: string; bg: string }> = {
  green: { fg: colors.primary, bg: colors.primaryLight },
  blue: { fg: colors.blue, bg: colors.blueLight },
  amber: { fg: colors.warning, bg: colors.warningLight },
  red: { fg: colors.danger, bg: colors.dangerLight },
  slate: { fg: '#334155', bg: colors.slateLight },
};

const CARD_SHADOW = Platform.select<ViewStyle>({ android: { elevation: 2 }, default: { boxShadow: '0 6px 18px rgba(15, 23, 42, 0.06)' } });

const styles = StyleSheet.create({
  tagPrimary: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18, letterSpacing: 0.6 },
  tagSecondary: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12, fontVariant: ['tabular-nums'] },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  card: { backgroundColor: colors.surface, borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...CARD_SHADOW },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, backgroundColor: colors.primaryLight, borderBottomWidth: 1, borderBottomColor: '#D1FAE5' },
  heroBadge: { width: 56, height: 56, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 },
  heroValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 40, lineHeight: 46, fontVariant: ['tabular-nums'] },
  heroSubtitle: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 13 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#A7F3D0' },
  toggleText: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 13 },
  body: { padding: 16, gap: 22 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  hint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: -4 },
  speciesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  speciesCell: { flexBasis: '46%', flexGrow: 1 },
  speciesCellWide: { flexBasis: '100%' },
  species: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 72, padding: 12, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  speciesSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  speciesIcon: { width: 44, height: 44, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  speciesValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24, lineHeight: 28, fontVariant: ['tabular-nums'] },
  speciesLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 13 },
  kpiRow: { flexDirection: 'row', gap: 10 },
  kpi: { flex: 1, minWidth: 0, gap: 4, padding: 14, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  kpiTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  kpiIcon: { width: 40, height: 40, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  kpiShare: { fontFamily: Fonts.semiBold, fontSize: 12, fontVariant: ['tabular-nums'] },
  kpiValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 30, lineHeight: 36, fontVariant: ['tabular-nums'] },
  kpiLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 13 },
  row: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowId: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  tagRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  speciesTag: { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, maxWidth: '50%' },
  speciesTagText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 11 },
  breedText: { flexShrink: 1, color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  rowMeta: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ownerText: { flex: 1, color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
});
