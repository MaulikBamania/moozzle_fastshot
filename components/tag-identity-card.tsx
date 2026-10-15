import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Text } from '@/components/translated-text';
import { colors, formatMoozzleId } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { animalAgeText } from '@/lib/age';
import { animalTypeFromCode, formatLocalDateTime } from '@/lib/demographics';
import { hasTag, tagLabel } from '@/lib/tag-id';
import { useBovineData } from '@/store/useBovineStore';
import type { MatchCandidate } from '@/store/types';

type Tone = 'green' | 'amber' | 'slate';

const TONES: Record<Tone, { bg: string; kicker: string; chip: string }> = {
  green: { bg: '#064E3B', kicker: '#A7F3D0', chip: 'rgba(167, 243, 208, 0.16)' },
  amber: { bg: '#78350F', kicker: '#FDE68A', chip: 'rgba(253, 230, 138, 0.16)' },
  slate: { bg: '#1E293B', kicker: '#CBD5E1', chip: 'rgba(203, 213, 225, 0.14)' },
};

const BIOMETRIC_LABELS: Record<string, string> = { enrolled: 'Enrolled', pending_quality: 'Pending quality', retired: 'Retired' };

function capital(value: string | null | undefined): string {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}

/**
 * Primary identifier on the match screens: the Tag ID in large, high-contrast type. Tapping it reveals the
 * animal's other details. Out-of-scope candidates are never described.
 */
export function TagIdentityCard({ candidate, tone = 'green', caption, initiallyOpen = false }: { candidate: MatchCandidate; tone?: Tone; caption?: string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const { animals } = useBovineData();
  // The locally loaded record (RLS-scoped) adds owner details the match payload does not carry.
  const animal = useMemo(
    () => (candidate.in_scope ? animals.find((item) => (candidate.animal_id ? item.id === candidate.animal_id : item.moozzle_id === candidate.moozzle_id)) ?? null : null),
    [animals, candidate.animal_id, candidate.in_scope, candidate.moozzle_id],
  );
  const palette = TONES[tone];
  const tag = animal?.tag_id || candidate.tag_id || '';

  const rows = useMemo(() => {
    if (!candidate.in_scope) return [];
    const location = [animal?.village ?? candidate.village, animal?.district ?? candidate.district, animal?.state ?? candidate.state].filter(Boolean).join(', ');
    const items: { label: string; value: string }[] = [
      { label: 'Species', value: animal?.animal_type ?? animalTypeFromCode(candidate.species) },
      { label: 'Breed', value: animal?.breed ?? candidate.breed ?? '' },
      { label: 'Sex', value: animal?.sex ?? capital(candidate.sex) },
      { label: 'Age', value: animalAgeText(animal ?? candidate) },
      { label: 'Age group', value: animal?.age_group ?? candidate.age_group ?? '' },
      { label: 'Owner / Farmer', value: animal?.owner_visible ? animal.owner_name : '' },
      { label: 'Owner phone', value: animal?.owner_visible ? animal.owner_phone : '' },
      { label: 'Farm', value: animal?.farm_name ?? candidate.farm_name ?? '' },
      { label: 'Location', value: location },
      { label: 'Biometric status', value: animal?.biometric_status ?? BIOMETRIC_LABELS[candidate.biometric_status ?? ''] ?? '' },
      { label: 'Record status', value: animal?.approval_status ?? candidate.approval_status ?? '' },
      { label: 'Status I · II', value: animal?.production_status || animal?.pregnancy_status ? `${animal?.production_status ?? 'NA'} · ${animal?.pregnancy_status ?? 'NA'}` : '' },
      { label: 'Registered', value: animal?.registration_date ? formatLocalDateTime(new Date(animal.registration_date)) : '' },
    ];
    return items.map((item) => ({ ...item, value: item.value?.trim() ? item.value : 'Not recorded' }));
  }, [animal, candidate]);

  if (!candidate.in_scope) {
    return (
      <View style={[styles.hero, { backgroundColor: TONES.slate.bg }]}>
        <Text style={[styles.kicker, { color: TONES.slate.kicker }]}>REGISTERED OUTSIDE YOUR SCOPE</Text>
        <Text selectable style={styles.maskedId}>{candidate.moozzle_id}</Text>
        <Text style={[styles.caption, { color: TONES.slate.kicker }]}>{capital(candidate.species)} · Tag ID and details are withheld. Contact the owning organisation.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Tag ID ${hasTag(tag) ? tag : 'not recorded'}. ${open ? 'Hide' : 'Show'} animal details`}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
      >
        {({ pressed }) => (
          <View style={[styles.hero, { backgroundColor: palette.bg }, open && styles.heroOpen, pressed && styles.pressed]}>
            <View style={styles.heroTop}>
              <Ionicons name="pricetag" size={15} color={palette.kicker} />
              <Text style={[styles.kicker, { color: palette.kicker }]}>TAG ID</Text>
            </View>
            <Text selectable style={[styles.tag, !hasTag(tag) && styles.tagMissing]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{tagLabel(tag)}</Text>
            <Text selectable style={[styles.moozzle, { color: palette.kicker }]}>MOOZZLE ID {formatMoozzleId(candidate.moozzle_id)}</Text>
            {caption ? <Text style={[styles.caption, { color: palette.kicker }]}>{caption}</Text> : null}
            <View style={[styles.toggle, { backgroundColor: palette.chip }]}>
              <Text style={styles.toggleText}>{open ? 'Hide animal details' : 'Tap to view animal details'}</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.surface} />
            </View>
          </View>
        )}
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.details}>
          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text selectable style={[styles.rowValue, row.value === 'Not recorded' && styles.rowMissing]}>{row.value}</Text>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 18, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  hero: { padding: 18, gap: 6, borderRadius: 18, borderCurve: 'continuous' },
  heroOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  pressed: { opacity: 0.9 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: { fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 2 },
  tag: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 40, lineHeight: 48, letterSpacing: 1.5 },
  tagMissing: { fontSize: 26, lineHeight: 34, opacity: 0.75 },
  moozzle: { fontFamily: Fonts.semiBold, fontSize: 13, letterSpacing: 0.8, fontVariant: ['tabular-nums'] },
  maskedId: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 22, letterSpacing: 1 },
  caption: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  toggle: { marginTop: 8, minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  toggleText: { color: colors.surface, fontFamily: Fonts.semiBold, fontSize: 13, flexShrink: 1 },
  details: { paddingHorizontal: 16, paddingVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 13, width: '40%' },
  rowValue: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14, flex: 1, textAlign: 'right' },
  rowMissing: { color: colors.muted, fontFamily: Fonts.regular },
});
