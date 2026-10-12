import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { AnimalPhoto, approvalTone, colors, formatMoozzleId, Pill } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { formatAgeShort } from '@/lib/age';
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

function Metric({ label, value, tone = 'slate', selected, onPress }: { label: string; value: number; tone?: Tone; selected?: boolean; onPress?: () => void }) {
  const body = (
    <View style={[styles.metric, selected && styles.metricSelected]}>
      <Text style={[styles.metricValue, { color: TONE_COLOR[tone] }]}>{value}</Text>
      <Text numberOfLines={1} style={styles.metricLabel}>{label}</Text>
    </View>
  );
  if (!onPress) return <View style={styles.metricCell}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={styles.metricCell}>
      {({ pressed }) => <View style={pressed && styles.pressed}>{body}</View>}
    </Pressable>
  );
}

function Group({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <Ionicons name={icon} size={13} color={colors.muted} />
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
      <View style={styles.metricRow}>{children}</View>
    </View>
  );
}

/** Compact demographic summary of every animal in the user's scope (unfiltered). */
export const AnimalOverview = memo(function AnimalOverview({ animals, category, onCategory }: { animals: readonly Animal[]; category: 'All' | AnimalCategory; onCategory: (value: 'All' | AnimalCategory) => void }) {
  const [open, setOpen] = useState(true);
  const stats = useMemo(() => computeOverview(animals), [animals]);

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Toggle animal overview" onPress={() => setOpen((value) => !value)}>
        {({ pressed }) => (
          <View style={[styles.head, pressed && styles.pressed]}>
            <View style={styles.totalBadge}>
              <Ionicons name="paw" size={18} color={colors.surface} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.headLabel}>Total Animals</Text>
              <Text selectable style={styles.headValue}>{stats.total}</Text>
            </View>
            <Text style={styles.headHint}>{open ? 'Hide' : 'Details'}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
          </View>
        )}
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Group icon="git-branch-outline" title="Species">
            {ANIMAL_CATEGORIES.map((item) => (
              <Metric key={item} label={item} value={stats.species[item]} tone="green" selected={category === item} onPress={() => onCategory(category === item ? 'All' : item)} />
            ))}
          </Group>
          <View style={styles.split}>
            <Group icon="water-outline" title="Production">
              <Metric label="Milk" value={stats.milk} tone="blue" />
              <Metric label="Dry" value={stats.dry} tone="amber" />
            </Group>
            <Group icon="heart-outline" title="Pregnancy">
              <Metric label="Pregnant" value={stats.pregnant} tone="red" />
            </Group>
            <Group icon="people-outline" title="Dairy Society">
              <Metric label="Giving milk" value={stats.dairy} tone="green" />
            </Group>
          </View>
          <Group icon="shield-checkmark-outline" title="Verification">
            <Metric label="Submitted" value={stats.submitted} tone="amber" />
            <Metric label="Approved" value={stats.approved} tone="green" />
          </Group>
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
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${animal.breed} ${formatMoozzleId(animal.moozzle_id)}`} onPress={() => onPress(animal)}>
      {({ pressed }) => (
        <View style={[styles.row, pressed && styles.pressed]}>
          <View style={styles.rowTop}>
            <AnimalPhoto animal={animal} size={64} />
            <View style={styles.flex}>
              <Text selectable style={styles.rowId}>{formatMoozzleId(animal.moozzle_id)}</Text>
              <View style={styles.tagRow}>
                <View style={styles.speciesTag}>
                  <Text numberOfLines={1} style={styles.speciesTagText}>{category}</Text>
                </View>
                <Text numberOfLines={1} style={styles.breedText}>{animal.breed}</Text>
              </View>
              <View style={styles.tagRow}>
                <Text style={styles.rowMeta}>{animal.sex} · {formatAgeShort(animal.age_years, animal.age_months)}</Text>
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

const TONE_COLOR: Record<Tone, string> = {
  green: colors.primary,
  blue: colors.blue,
  amber: colors.warning,
  red: colors.danger,
  slate: colors.text,
};

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 44 },
  totalBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  headLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  headValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24, fontVariant: ['tabular-nums'] },
  headHint: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 13 },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  split: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 12 },
  group: { gap: 6, flexGrow: 1 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  groupTitle: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricCell: { minWidth: 64, flexGrow: 1 },
  metric: { minHeight: 44, borderRadius: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  metricSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  metricValue: { fontFamily: Fonts.bold, fontSize: 17, fontVariant: ['tabular-nums'] },
  metricLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11, marginTop: 1 },
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
