import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { CaptureImage } from '@/components/biometric-ui';
import { Card, colors, ErrorState, formatMoozzleId, LoadingState, OptionChip, Pill, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { TIER_LABELS } from '@/lib/analytics/filters';
import { formatTimestamp, SCAN_TYPE_LABELS } from '@/lib/analytics/metrics';
import { reasonText } from '@/lib/biometric/decision';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { messageOf } from '@/store/useBovineStore';
import type { ReviewCandidate, ReviewDecision, ScanReviewItem } from '@/store/types';

const DECISION_LABEL: Record<ReviewDecision, string> = {
  confirmed: 'Identity confirmed',
  rejected: 'No match',
  inconclusive: 'Inconclusive — recapture',
};

/**
 * REVIEW REQUIRED scans awaiting an authorised reviewer. The server returns only scans whose candidate animals
 * the reviewer may review (never their own scans) and masks candidates outside their scope.
 */
export function ScanReviewQueue() {
  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase.rpc('scan_review_queue');
    if (error) throw error;
    return (data as ScanReviewItem[]) ?? [];
  }, []);
  const queue = useAsyncResource(fetchQueue, 'The biometric review queue could not be loaded.');
  const [showResolved, setShowResolved] = useState(false);

  if (!queue.data && queue.loading) return <LoadingState label="Loading biometric review queue…" />;
  if (!queue.data) return <ErrorState message={queue.error || 'The biometric review queue could not be loaded.'} onRetry={() => void queue.reload()} />;
  const open = queue.data.filter((item) => item.review_status === 'requested');
  const resolved = queue.data.filter((item) => item.review_status === 'resolved');

  return (
    <View style={styles.stack}>
      <View style={styles.head}>
        <Text style={styles.section}>Biometric match reviews ({open.length})</Text>
        <OptionChip label={showResolved ? 'Hide resolved' : `Resolved (${resolved.length})`} selected={showResolved} onPress={() => setShowResolved((v) => !v)} tone="blue" />
      </View>
      {queue.error ? <Text selectable style={styles.error}>{queue.error}</Text> : null}
      {open.length === 0 ? <Text style={styles.muted}>No possible matches are waiting for your review.</Text> : null}
      {open.map((item) => <ReviewCard key={item.id} item={item} onDone={queue.reload} />)}
      {showResolved ? resolved.map((item) => <ReviewCard key={item.id} item={item} onDone={queue.reload} />) : null}
    </View>
  );
}

function ReviewCard({ item, onDone }: { item: ScanReviewItem; onDone: () => Promise<void> }) {
  const [selected, setSelected] = useState<ReviewCandidate | null>(item.candidates[0] ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState('');
  const resolved = item.review_status === 'resolved';

  const decide = useCallback(async (decision: ReviewDecision) => {
    if (note.trim().length < 10) {
      setError('Explain the decision (at least 10 characters).');
      return;
    }
    setBusy(decision);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('resolve_scan_review', { p_scan: item.id, p_decision: decision, p_moozzle_id: decision === 'confirmed' ? selected?.moozzle_id ?? '' : '', p_note: note.trim() });
      if (rpcError) throw rpcError;
      await onDone();
    } catch (caught) {
      console.error('Review decision failed', caught);
      setError(messageOf(caught, 'The review decision could not be saved.'));
    } finally {
      setBusy(null);
    }
  }, [item.id, note, onDone, selected]);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title}>{SCAN_TYPE_LABELS[item.scan_type]} · possible match</Text>
          <Text style={styles.meta}>{formatTimestamp(item.created_at)} · requested by {item.requester_role} · cfg v{item.config_version ?? '—'} · {TIER_LABELS[item.data_source]}</Text>
        </View>
        <View style={styles.badge}><Pill label={resolved ? DECISION_LABEL[item.review_decision ?? 'inconclusive'] : 'REVIEW REQUIRED'} tone={resolved ? 'slate' : 'amber'} /></View>
      </View>
      <Text style={styles.muted}>{reasonText(item.decision_reason)}{item.review_note ? ` · ${item.review_note}` : ''}</Text>
      <View style={styles.compare}>
        <CaptureImage path={item.probe_image_path} label="SCAN" size={128} />
        <Ionicons name="git-compare-outline" size={20} color={colors.muted} />
        <CaptureImage path={selected?.in_scope ? selected.reference_image_path : null} label={selected ? `#${selected.rank}` : 'CANDIDATE'} size={128} />
      </View>
      {selected ? <Text selectable style={styles.body}>Similarity to candidate #{selected.rank}: {selected.score.toFixed(3)} (below the confirmed threshold or too close to another candidate)</Text> : null}
      <Text style={styles.kicker}>CANDIDATES</Text>
      <View style={styles.chips}>
        {item.candidates.map((c) => (
          <OptionChip key={`${c.rank}-${c.moozzle_id}`} label={`#${c.rank} ${c.in_scope ? formatMoozzleId(c.moozzle_id) : c.moozzle_id} · ${c.score.toFixed(3)}`} selected={selected?.rank === c.rank} onPress={() => setSelected(c)} tone="blue" />
        ))}
      </View>
      {selected?.in_scope ? (
        <View style={styles.record}>
          <Text style={styles.body}>{selected.breed} {selected.species} · {selected.sex} · {selected.farm_name || selected.village}</Text>
          <PrimaryButton label="Open Candidate Record" variant="outline" icon="document-text-outline" onPress={() => router.push(`/animal/${selected.moozzle_id}`)} />
        </View>
      ) : selected ? <Text style={styles.muted}>This candidate is outside your scope; only its existence is shown.</Text> : null}
      {resolved ? (
        <Text selectable style={styles.body}>Decision: {DECISION_LABEL[item.review_decision ?? 'inconclusive']}{item.review_confirmed_moozzle_id ? ` · ${formatMoozzleId(item.review_confirmed_moozzle_id)}` : ''} · {item.reviewed_at ? formatTimestamp(item.reviewed_at) : ''} · {item.review_resolution_note}</Text>
      ) : (
        <>
          <TextField label="Reviewer reason (required)" value={note} onChangeText={setNote} placeholder="What you compared and why" multiline />
          <View style={styles.row}>
            <PrimaryButton label={busy === 'confirmed' ? 'Saving…' : 'Confirm Candidate'} onPress={() => void decide('confirmed')} disabled={!!busy || !selected?.can_decide} style={styles.action} />
            <PrimaryButton label={busy === 'rejected' ? 'Saving…' : 'No Match'} variant="danger" onPress={() => void decide('rejected')} disabled={!!busy} style={styles.action} />
            <PrimaryButton label={busy === 'inconclusive' ? 'Saving…' : 'Inconclusive'} variant="outline" onPress={() => void decide('inconclusive')} disabled={!!busy} style={styles.action} />
          </View>
          {selected && !selected.can_decide ? <Text style={styles.muted}>You can only confirm a candidate inside your review scope.</Text> : null}
        </>
      )}
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  section: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.9, textTransform: 'uppercase' },
  card: { gap: 10 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  meta: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12, marginTop: 2 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  body: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  kicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  badge: { flexShrink: 1, maxWidth: '45%' },
  compare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  record: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1, flexBasis: 120, minHeight: 44 },
});
