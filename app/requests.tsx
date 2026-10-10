import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreen } from '@/components/app-chrome';
import { FormSheet } from '@/components/record-forms';
import { Card, colors, DataGate, EmptyState, formatMoozzleId, OptionChip, Pill, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { canRequestService } from '@/lib/rbac';
import { createRequest, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';
import type { RequestRow } from '@/store/types';

type NewKind = 'vet_help' | 'ai_service' | 'correction';

const KIND_LABEL: Record<RequestRow['kind'], string> = {
  transfer: 'Ownership transfer',
  retire: 'Retirement',
  correction: 'Correction',
  vet_help: 'Veterinary help',
  ai_service: 'AI service',
};

export default function RequestsScreen() {
  return (
    <DataGate>
      <StackScreen title="My Requests" eyebrow="Help & service" destination="requests">
        <RequestsContent />
      </StackScreen>
    </DataGate>
  );
}

function RequestsContent() {
  const session = useSession();
  const { animals } = useBovineData();
  const requests = useBovineStore((state) => state.requestRows);
  const mine = useMemo(() => requests.filter((request) => request.requested_by === session.userId), [requests, session.userId]);
  const eligible = useMemo(() => animals.filter((animal) => animal.current_status === 'Active' && animal.approval_status !== 'Draft' && !animal.pending_sync), [animals]);
  const canService = session.role ? canRequestService(session.role) : false;
  const [kind, setKind] = useState<NewKind>(canService ? 'vet_help' : 'correction');
  const [animalId, setAnimalId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const selected = eligible.find((animal) => animal.id === animalId) ?? null;

  return (
    <>
      <Card style={styles.card}>
        <Text style={styles.title}>New request</Text>
        <View style={styles.chips}>
          {canService ? <OptionChip label="Get veterinary help" selected={kind === 'vet_help'} onPress={() => setKind('vet_help')} /> : null}
          {canService ? <OptionChip label="Request AI service" selected={kind === 'ai_service'} onPress={() => setKind('ai_service')} /> : null}
          <OptionChip label="Correct my record" selected={kind === 'correction'} onPress={() => setKind('correction')} />
        </View>
        <Text style={styles.label}>Choose the animal</Text>
        {eligible.length === 0 ? <Text style={styles.muted}>No active animals in your records yet.</Text> : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.hchips}>
            {eligible.map((animal) => <OptionChip key={animal.id} label={`${animal.breed} · ${animal.moozzle_id.slice(-4)}`} selected={animalId === animal.id} onPress={() => setAnimalId(animal.id)} />)}
          </ScrollView>
        )}
        <PrimaryButton label="Continue" icon="arrow-forward" onPress={() => setOpen(true)} disabled={!selected} />
        <Text style={styles.muted}>Ownership transfers and retirement requests are made from the animal’s profile.</Text>
      </Card>
      {notice ? <View style={styles.notice}><Text selectable style={styles.noticeText}>{notice}</Text></View> : null}
      <Text style={styles.section}>Submitted by you ({mine.length})</Text>
      {mine.length === 0 ? <EmptyState title="No requests yet" message="Requests you send appear here with their review status." /> : null}
      {mine.map((request) => (
        <Card key={request.id} style={styles.card}>
          <View style={styles.top}>
            <Text style={styles.kind}>{KIND_LABEL[request.kind]}</Text>
            <Pill label={request.status} tone={request.status === 'Submitted' ? 'amber' : request.status === 'Rejected' || request.status === 'Declined' ? 'red' : 'green'} />
          </View>
          <Text selectable style={styles.muted}>{formatMoozzleId(request.moozzle_id)} · {new Date(request.created_at).toLocaleDateString()}</Text>
          {request.payload.note ? <Text selectable style={styles.body}>{request.payload.note}</Text> : null}
          {request.review_note ? <Text selectable style={styles.review}>Reviewer ({request.reviewer_role}): {request.review_note}</Text> : null}
        </Card>
      ))}
      {open && selected ? (
        <FormSheet
          visible
          heading={kind === 'vet_help' ? 'Get veterinary help' : kind === 'ai_service' ? 'Request AI service' : 'Request a correction'}
          specs={[{ title: 'Request', fields: kind === 'correction' ? [{ key: 'note', label: 'What is incorrect?', required: true, multiline: true }, { key: 'breed', label: 'Correct breed (optional)' }, { key: 'age_years', label: 'Correct age – years (optional)', keyboard: 'numeric' }, { key: 'age_months', label: 'Correct age – extra months, 0-11 (optional)', keyboard: 'numeric' }, { key: 'village', label: 'Correct village (optional)' }] : [{ key: 'note', label: kind === 'vet_help' ? 'What is wrong?' : 'Heat observed / preferred time', required: true, multiline: true }, { key: 'urgency', label: 'Urgency (Normal / Urgent)', placeholder: 'Normal' }] }]}
          submitLabel="Send Request"
          onClose={() => setOpen(false)}
          onSubmit={async ({ values }) => {
            await createRequest(kind, selected.id, selected.moozzle_id, values);
            setOpen(false);
            setNotice(kind === 'correction' ? 'Correction request sent for review.' : 'Your request has been sent.');
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  label: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scroll: { flexGrow: 0 },
  hchips: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12 },
  notice: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12 },
  noticeText: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  section: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, marginTop: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  body: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13 },
  review: { color: colors.blue, fontFamily: Fonts.medium, fontSize: 12 },
});
