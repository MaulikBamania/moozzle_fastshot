import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { StackScreen } from '@/components/app-chrome';
import { FormSheet } from '@/components/record-forms';
import { Card, colors, DataGate, EmptyState, formatMoozzleId, Pill, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { formatAgeShort } from '@/lib/age';
import type { Role } from '@/lib/rbac';
import { reviewAnimal, reviewRequest, useBovineData, useBovineStore, useSession } from '@/store/useBovineStore';
import type { Animal, RequestRow } from '@/store/types';

const KIND_LABEL: Record<RequestRow['kind'], string> = {
  transfer: 'Ownership transfer',
  retire: 'Retirement request',
  correction: 'Correction request',
  vet_help: 'Veterinary help',
  ai_service: 'AI service request',
};

/** Which request kinds the active role can decide (mirrors review_request on the server). */
function reviewable(role: Role, kind: RequestRow['kind']): boolean {
  switch (kind) {
    case 'transfer':
      return role === 'Super Administrator' || role === 'Organisation Administrator' || role === 'Government Officer' || role === 'Livestock Inspector';
    case 'retire':
      return role === 'Super Administrator' || role === 'Organisation Administrator' || role === 'Government Officer';
    case 'correction':
      return role === 'Super Administrator' || role === 'Organisation Administrator';
    case 'vet_help':
      return role === 'Veterinarian';
    case 'ai_service':
      return role === 'AI Technician';
    default:
      return false;
  }
}

type Decision = { target: 'animal'; animal: Animal; decision: 'Approved' | 'Rejected' } | { target: 'request'; request: RequestRow; decision: string };

export default function ApprovalsScreen() {
  return (
    <DataGate>
      <StackScreen title="Approvals & Requests" eyebrow="Review queue" destination="approvals">
        <ApprovalsContent />
      </StackScreen>
    </DataGate>
  );
}

function ApprovalsContent() {
  const session = useSession();
  const role = session.role as Role;
  const { animals } = useBovineData();
  const requests = useBovineStore((state) => state.requestRows);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notice, setNotice] = useState('');

  const registrations = useMemo(() => {
    if (!(role === 'Organisation Administrator' || role === 'Government Officer' || (role === 'Super Administrator' && session.privileged))) return [];
    return animals.filter((animal) => (animal.approval_status === 'Submitted' || animal.approval_status === 'Pending Review') && animal.created_by !== session.userId && !animal.pending_sync);
  }, [animals, role, session.privileged, session.userId]);
  const pending = useMemo(() => requests.filter((request) => request.status === 'Submitted' && request.requested_by !== session.userId && reviewable(role, request.kind)), [requests, role, session.userId]);
  const accepted = useMemo(() => requests.filter((request) => request.status === 'Accepted' && (request.kind === 'vet_help' || request.kind === 'ai_service') && reviewable(role, request.kind)), [requests, role]);
  const decided = useMemo(() => requests.filter((request) => request.status !== 'Submitted' && request.status !== 'Accepted').slice(0, 10), [requests]);

  return (
    <>
      {notice ? <View style={styles.notice}><Text selectable style={styles.noticeText}>{notice}</Text></View> : null}
      {role === 'Super Administrator' && !session.privileged ? <Text style={styles.muted}>Start privileged access (Security) to review identifiable registrations.</Text> : null}

      <Text style={styles.section}>Registrations awaiting approval ({registrations.length})</Text>
      {registrations.length === 0 ? <EmptyState title="No registrations waiting" message="New registrations from field staff appear here for independent review." /> : null}
      {registrations.map((animal) => (
        <Card key={animal.id} style={styles.card}>
          <View style={styles.top}>
            <Text selectable style={styles.id}>{formatMoozzleId(animal.moozzle_id)}</Text>
            <Pill label={animal.approval_status} tone="amber" />
          </View>
          <Text style={styles.meta}>{animal.breed} {animal.animal_type} · {animal.sex} · {formatAgeShort(animal.age_years, animal.age_months)} · {animal.farm_name || animal.village}</Text>
          {animal.duplicate_of ? <Text style={styles.warn}>Possible duplicate of an existing identity — verify before approving.</Text> : null}
          <View style={styles.row}>
            <PrimaryButton label="Open" variant="outline" onPress={() => router.push(`/animal/${animal.moozzle_id}`)} style={styles.flex} />
            <PrimaryButton label="Approve" onPress={() => setDecision({ target: 'animal', animal, decision: 'Approved' })} style={styles.flex} />
            <PrimaryButton label="Reject" variant="danger" onPress={() => setDecision({ target: 'animal', animal, decision: 'Rejected' })} style={styles.flex} />
          </View>
        </Card>
      ))}

      <Text style={styles.section}>Requests awaiting your decision ({pending.length})</Text>
      {pending.length === 0 ? <EmptyState title="No open requests" message="Transfers, retirements, corrections and service requests in your scope appear here." /> : null}
      {pending.map((request) => <RequestCard key={request.id} request={request} onDecide={(value) => setDecision({ target: 'request', request, decision: value })} />)}

      {accepted.length > 0 ? <Text style={styles.section}>Accepted visits ({accepted.length})</Text> : null}
      {accepted.map((request) => <RequestCard key={request.id} request={request} onDecide={(value) => setDecision({ target: 'request', request, decision: value })} />)}

      {decided.length > 0 ? <Text style={styles.section}>Recently decided</Text> : null}
      {decided.map((request) => (
        <Card key={request.id} style={styles.card}>
          <View style={styles.top}><Text style={styles.kind}>{KIND_LABEL[request.kind]}</Text><Pill label={request.status} tone={request.status === 'Rejected' || request.status === 'Declined' ? 'red' : 'green'} /></View>
          <Text style={styles.meta}>{formatMoozzleId(request.moozzle_id)} · by {request.requester_name || request.requester_role}{request.reviewer_role ? ` · reviewed by ${request.reviewer_role}` : ''}</Text>
        </Card>
      ))}

      {decision ? (
        <FormSheet
          visible
          heading={`${decision.decision} — ${decision.target === 'animal' ? 'registration' : KIND_LABEL[decision.request.kind].toLowerCase()}`}
          specs={[{ title: 'Decision', fields: [{ key: 'note', label: 'Note / approval reference', required: decision.decision === 'Rejected' || decision.decision === 'Declined', multiline: true }] }]}
          submitLabel={decision.decision}
          danger={decision.decision === 'Rejected' || decision.decision === 'Declined'}
          confirmText="Your decision is checked against your authority on the server and recorded in the audit trail."
          onClose={() => setDecision(null)}
          onSubmit={async ({ values }) => {
            if (decision.target === 'animal') await reviewAnimal(decision.animal.id, decision.decision, values.note ?? '', decision.animal.moozzle_id);
            else await reviewRequest(decision.request.id, decision.decision, values.note ?? '', decision.request.moozzle_id);
            setDecision(null);
            setNotice(`${decision.decision}. The requester has been notified.`);
          }}
        />
      ) : null}
    </>
  );
}

function RequestCard({ request, onDecide }: { request: RequestRow; onDecide: (decision: string) => void }) {
  const service = request.kind === 'vet_help' || request.kind === 'ai_service';
  const payloadLines = Object.entries(request.payload).filter(([, value]) => value);
  return (
    <Card style={styles.card}>
      <View style={styles.top}><Text style={styles.kind}>{KIND_LABEL[request.kind]}</Text><Pill label={request.status} tone="amber" /></View>
      <Text selectable style={styles.meta}>MOOZZLE ID {formatMoozzleId(request.moozzle_id)} · {request.requester_name || 'Unknown'} ({request.requester_role}) · {new Date(request.created_at).toLocaleDateString()}</Text>
      {payloadLines.map(([key, value]) => <Text key={key} selectable style={styles.payload}><Text style={styles.payloadKey}>{key.replace(/_/g, ' ')}: </Text>{value}</Text>)}
      <View style={styles.row}>
        <PrimaryButton label="Open" variant="outline" onPress={() => router.push(`/animal/${request.moozzle_id}`)} style={styles.flex} />
        {service ? (
          request.status === 'Accepted' ? <PrimaryButton label="Completed" onPress={() => onDecide('Completed')} style={styles.flex} /> : (
            <>
              <PrimaryButton label="Accept" onPress={() => onDecide('Accepted')} style={styles.flex} />
              <PrimaryButton label="Decline" variant="danger" onPress={() => onDecide('Declined')} style={styles.flex} />
            </>
          )
        ) : (
          <>
            <PrimaryButton label="Approve" onPress={() => onDecide('Approved')} style={styles.flex} />
            <PrimaryButton label="Reject" variant="danger" onPress={() => onDecide('Rejected')} style={styles.flex} />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingHorizontal: 6 },
  notice: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12 },
  noticeText: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  section: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, marginTop: 6 },
  card: { gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  id: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  kind: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  meta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  warn: { color: colors.danger, fontFamily: Fonts.semiBold, fontSize: 12 },
  payload: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13 },
  payloadKey: { fontFamily: Fonts.semiBold, textTransform: 'capitalize' },
  row: { flexDirection: 'row', gap: 8 },
});
