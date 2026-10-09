import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { colors, DataGate, EmptyState, formatMoozzleId, OptionChip, Pill } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { vaccinationsDue } from '@/lib/dashboard';
import type { Destination, ServiceKind } from '@/lib/rbac';
import { useBovineData, useSession } from '@/store/useBovineStore';

const META: Record<ServiceKind, { title: string; dest: Destination; icon: keyof typeof Ionicons.glyphMap }> = {
  health: { title: 'Health & Vaccination', dest: 'services-health', icon: 'medkit-outline' },
  ai: { title: 'Breeding & AI Services', dest: 'services-ai', icon: 'flask-outline' },
  insurance: { title: 'Insurance Records', dest: 'services-insurance', icon: 'umbrella-outline' },
  traceability: { title: 'Movement & Traceability', dest: 'services-traceability', icon: 'navigate-outline' },
  operations: { title: 'Daily Operations', dest: 'services-operations', icon: 'today-outline' },
};

export default function ServicesScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (params.type && params.type in META ? params.type : 'health') as ServiceKind;
  return (
    <DataGate>
      <StackScreen title={META[type].title} eyebrow="Service records" destination={META[type].dest}>
        <ServicesContent type={type} />
      </StackScreen>
    </DataGate>
  );
}

function ServicesContent({ type }: { type: ServiceKind }) {
  const session = useSession();
  const { animals, records } = useBovineData();
  const [mineOnly, setMineOnly] = useState(false);
  const byAnimal = useMemo(() => new Map(animals.map((animal) => [animal.id, animal])), [animals]);
  const list = useMemo(() => records.filter((record) => record.service_type === type && (!mineOnly || record.author_id === session.userId)), [mineOnly, records, session.userId, type]);
  const due = useMemo(() => (type === 'health' ? vaccinationsDue(animals, records) : []), [animals, records, type]);
  const writable = type === 'health' ? 'Open an animal to add a medical or vaccination record.' : type === 'ai' ? 'Open an animal to record an insemination.' : type === 'traceability' ? 'Open an animal to record movement or inspection.' : type === 'operations' ? 'Open an animal to record milk or feed.' : 'Insurance verification is recorded from Verify Animal.';

  return (
    <>
      <View style={styles.filters}>
        <OptionChip label="All in my scope" selected={!mineOnly} onPress={() => setMineOnly(false)} />
        <OptionChip label="Recorded by me" selected={mineOnly} onPress={() => setMineOnly(true)} />
      </View>
      <Text style={styles.muted}>{writable}</Text>
      {type === 'health' && due.length > 0 ? (
        <View style={styles.due}>
          <Text style={styles.dueTitle}>{session.role === 'Farmer' ? 'Vaccination is due soon' : `Vaccinations due (${due.length})`}</Text>
          {due.slice(0, 6).map((animal) => (
            <Pressable key={animal.id} accessibilityRole="button" onPress={() => router.push(`/animal/${animal.moozzle_id}`)} style={styles.dueRow}>
              <Ionicons name="alarm-outline" size={16} color={colors.warning} />
              <Text style={styles.dueText}>{animal.breed} · {formatMoozzleId(animal.moozzle_id)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {list.length === 0 ? <EmptyState title="No records" message="Records your role may view appear here." /> : null}
      {list.map((record) => {
        const animal = byAnimal.get(record.animal_id);
        return (
          <Pressable key={record.id} accessibilityRole="button" onPress={() => animal && router.push(`/animal/${animal.moozzle_id}`)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.icon}><Ionicons name={META[type].icon} size={18} color={colors.primaryDark} /></View>
            <View style={styles.flex}>
              <View style={styles.top}>
                <Text style={styles.title}>{record.record_type}</Text>
                <Text style={styles.date}>{record.date}</Text>
              </View>
              <Text style={styles.meta}>{animal ? `${animal.breed} · ${formatMoozzleId(animal.moozzle_id)}` : 'Animal'} · {record.performed_by}</Text>
              <Text numberOfLines={2} style={styles.body}>{record.details}</Text>
              <View style={styles.pills}>
                {record.corrected_by ? <Pill label="Corrected" tone="slate" /> : null}
                {record.corrects_id ? <Pill label="Amendment" tone="blue" /> : null}
                {record.pending_sync ? <Pill label="Waiting to sync" tone="amber" /> : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  due: { backgroundColor: colors.warningLight, borderRadius: 14, padding: 12, gap: 4 },
  dueTitle: { color: '#92400E', fontFamily: Fonts.bold, fontSize: 14, marginBottom: 4 },
  dueRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dueText: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  row: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12 },
  pressed: { opacity: 0.85 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  date: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  meta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
  body: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13, marginTop: 4 },
  pills: { flexDirection: 'row', gap: 6, marginTop: 4 },
});
