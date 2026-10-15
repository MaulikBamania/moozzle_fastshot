import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { Card, colors, EmptyState, ErrorState, LoadingState, OptionChip, Pill, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { formatTimestamp } from '@/lib/analytics/metrics';
import { TIER_LABELS } from '@/lib/analytics/filters';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { messageOf } from '@/store/useBovineStore';
import { draftFrom, type ProposalDraft, proposalError } from '@/lib/analytics/governance';
import type { BiometricConfigRow, ConfigAuditRow, ConfigHistoryPayload, ConfigStatus, TestSessionRow } from '@/store/types';

const STATUS_TONE: Record<ConfigStatus, 'green' | 'blue' | 'amber' | 'red' | 'slate'> = {
  production: 'green',
  approved: 'blue',
  proposed: 'amber',
  rejected: 'red',
  retired: 'slate',
};

export function ThresholdGovernance() {
  const fetchHistory = useCallback(async () => {
    const { data, error } = await supabase.rpc('biometric_config_history');
    if (error) throw error;
    return data as ConfigHistoryPayload;
  }, []);
  const history = useAsyncResource(fetchHistory, 'Configuration history could not be loaded.');
  const [proposing, setProposing] = useState(false);
  const [draft, setDraft] = useState<ProposalDraft>(() => draftFrom(undefined));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const data = history.data;
  const production = data?.configs.find((c) => c.status === 'production');

  const startProposal = useCallback(() => {
    setDraft(draftFrom(production));
    setProposing(true);
    setNotice(null);
  }, [production]);

  const submitProposal = useCallback(async () => {
    const problem = proposalError(draft);
    if (problem) {
      setNotice({ tone: 'red', text: problem });
      return;
    }
    setBusy('propose');
    setNotice(null);
    try {
      const { data: created, error } = await supabase.rpc('propose_biometric_config', {
        p: {
          verify_accept: Number(draft.verify_accept),
          verify_review: Number(draft.verify_review),
          identify_accept: Number(draft.identify_accept),
          identify_review: Number(draft.identify_review),
          identify_margin: Number(draft.identify_margin),
          candidate_list_k: Number(draft.candidate_list_k),
          model_version: draft.model_version.trim(),
          validation_reference: draft.validation_reference.trim(),
          reason: draft.reason.trim(),
        },
      });
      if (error) throw error;
      setProposing(false);
      setNotice({ tone: 'green', text: `Config v${(created as { config_version: number }).config_version} proposed. It needs approval by a different privileged Super Administrator before promotion.` });
      await history.reload();
    } catch (caught) {
      console.error('Config proposal failed', caught);
      setNotice({ tone: 'red', text: messageOf(caught, 'The proposal could not be saved.') });
    } finally {
      setBusy(null);
    }
  }, [draft, history]);

  const act = useCallback(async (config: BiometricConfigRow, action: 'approve' | 'reject' | 'promote') => {
    const note = (notes[config.id] ?? '').trim();
    if (note.length < 15) {
      setNotice({ tone: 'red', text: action === 'promote' ? 'Give a promotion reason of at least 15 characters.' : 'Record the test evidence reviewed (at least 15 characters).' });
      return;
    }
    setBusy(`${action}-${config.id}`);
    setNotice(null);
    try {
      const { error } = action === 'promote'
        ? await supabase.rpc('promote_biometric_config', { p_id: config.id, p_reason: note })
        : await supabase.rpc('review_biometric_config', { p_id: config.id, p_decision: action, p_note: note });
      if (error) throw error;
      setNotice({ tone: 'green', text: action === 'promote' ? `Config v${config.config_version} is now in production. New scans are stamped with it.` : `Config v${config.config_version} ${action === 'approve' ? 'approved' : 'rejected'}.` });
      setNotes((current) => ({ ...current, [config.id]: '' }));
      await history.reload();
    } catch (caught) {
      console.error('Config action failed', caught);
      setNotice({ tone: 'red', text: messageOf(caught, 'The action could not be completed.') });
    } finally {
      setBusy(null);
    }
  }, [history, notes]);

  if (!data && history.loading) return <LoadingState label="Loading biometric configuration…" />;
  if (!data) return <ErrorState message={history.error || 'Configuration history could not be loaded.'} onRetry={() => void history.reload()} />;

  const field = (key: keyof ProposalDraft, label: string, numeric = true) => (
    <TextField key={key} label={label} value={draft[key]} onChangeText={(value) => setDraft((d) => ({ ...d, [key]: value }))} keyboardType={numeric ? 'decimal-pad' : 'default'} style={styles.field} />
  );

  return (
    <View style={styles.stack}>
      {production ? (
        <Card style={styles.card}>
          <View style={styles.head}><Text style={styles.title}>Production configuration v{production.config_version}</Text><Pill label="PRODUCTION" tone="green" /></View>
          <View style={styles.grid}>
            <Value label="1:1 accept (verify)" value={production.verify_accept.toFixed(3)} />
            <Value label="1:1 review" value={production.verify_review.toFixed(3)} />
            <Value label="1:N accept (identify)" value={production.identify_accept.toFixed(3)} />
            <Value label="1:N review" value={production.identify_review.toFixed(3)} />
            <Value label="1:N margin" value={production.identify_margin.toFixed(3)} />
            <Value label="Candidate list k" value={String(production.candidate_list_k)} />
          </View>
          <Text selectable style={styles.meta}>Model {production.model_version} · promoted {production.promoted_at ? formatTimestamp(production.promoted_at) : '—'}</Text>
          <Text selectable style={styles.meta}>Evidence: {production.validation_reference}</Text>
          <Text style={styles.muted}>Field users cannot change these values or override a rejection. Changes follow propose → independent approval → promotion, each audited with the old and new values.</Text>
        </Card>
      ) : <ErrorState message="No production configuration is approved — biometric matching is disabled." onRetry={() => void history.reload()} />}

      {notice ? <Text selectable style={notice.tone === 'red' ? styles.error : styles.ok}>{notice.text}</Text> : null}

      {data.can_propose && !proposing ? <PrimaryButton label="Propose New Configuration" icon="git-pull-request-outline" onPress={startProposal} /> : null}
      {!data.can_propose ? <Text style={styles.muted}>Only a Researcher or a Super Administrator with active privileged access can propose thresholds; only a privileged Super Administrator who did not propose a configuration can approve and promote it.</Text> : null}

      {proposing ? (
        <Card style={styles.card}>
          <Text style={styles.title}>Propose configuration</Text>
          <Text style={styles.kicker}>1:1 VERIFICATION</Text>
          <View style={styles.fieldRow}>{field('verify_accept', 'Accept ≥')}{field('verify_review', 'Review ≥')}</View>
          <Text style={styles.kicker}>1:N IDENTIFICATION</Text>
          <View style={styles.fieldRow}>{field('identify_accept', 'Accept ≥')}{field('identify_review', 'Review ≥')}</View>
          <View style={styles.fieldRow}>{field('identify_margin', 'Top-2 margin')}{field('candidate_list_k', 'Candidate list k')}</View>
          {field('model_version', 'Model version', false)}
          {field('validation_reference', 'Validation evidence (protocol / session / report ID)', false)}
          {field('reason', 'Reason for change', false)}
          <View style={styles.fieldRow}>
            <PrimaryButton label="Cancel" variant="outline" onPress={() => setProposing(false)} style={styles.flex} disabled={busy === 'propose'} />
            <PrimaryButton label={busy === 'propose' ? 'Submitting…' : 'Submit Proposal'} onPress={() => void submitProposal()} style={styles.flex} disabled={busy === 'propose'} />
          </View>
        </Card>
      ) : null}

      <Text style={styles.section}>Configuration versions</Text>
      {data.configs.map((config) => {
        const pending = config.status === 'proposed' || config.status === 'approved';
        const canAct = data.can_approve && pending && !(config.status === 'proposed' && config.own_proposal);
        return (
          <Card key={config.id} style={styles.card}>
            <View style={styles.head}><Text style={styles.title}>v{config.config_version}</Text><Pill label={config.status.toUpperCase()} tone={STATUS_TONE[config.status]} /></View>
            <Text selectable style={styles.meta}>1:1 {config.verify_accept.toFixed(3)} / {config.verify_review.toFixed(3)} · 1:N {config.identify_accept.toFixed(3)} / {config.identify_review.toFixed(3)} · margin {config.identify_margin.toFixed(3)} · k {config.candidate_list_k} · {config.model_version}</Text>
            <Text selectable style={styles.body}>{config.reason}</Text>
            <Text selectable style={styles.meta}>Proposed by {config.proposed_by_name} ({config.proposed_role || 'system'}) · {formatTimestamp(config.proposed_at)}</Text>
            {config.approved_by_name ? <Text selectable style={styles.meta}>{config.status === 'rejected' ? 'Rejected' : 'Approved'} by {config.approved_by_name} · {config.approved_at ? formatTimestamp(config.approved_at) : ''} · {config.approval_note}</Text> : null}
            {config.status === 'proposed' && config.own_proposal && data.can_approve ? <Text style={styles.muted}>Separation of duties: another administrator must approve your own proposal.</Text> : null}
            {canAct ? (
              <>
                <TextField label={config.status === 'approved' ? 'Promotion reason' : 'Test evidence reviewed'} value={notes[config.id] ?? ''} onChangeText={(value) => setNotes((current) => ({ ...current, [config.id]: value }))} placeholder="At least 15 characters" />
                <View style={styles.fieldRow}>
                  {config.status === 'proposed' ? (
                    <>
                      <PrimaryButton label="Reject" variant="outline" onPress={() => void act(config, 'reject')} disabled={!!busy} style={styles.flex} />
                      <PrimaryButton label={busy === `approve-${config.id}` ? 'Approving…' : 'Approve'} onPress={() => void act(config, 'approve')} disabled={!!busy} style={styles.flex} />
                    </>
                  ) : (
                    <PrimaryButton label={busy === `promote-${config.id}` ? 'Promoting…' : 'Promote to Production'} icon="rocket-outline" variant="danger" onPress={() => void act(config, 'promote')} disabled={!!busy} style={styles.flex} />
                  )}
                </View>
              </>
            ) : null}
          </Card>
        );
      })}

      <Text style={styles.section}>Immutable change audit</Text>
      {data.audit.length === 0 ? <EmptyState title="No changes" message="No configuration changes are recorded yet." /> : data.audit.map((row) => <AuditRow key={row.id} row={row} />)}
    </View>
  );
}

function AuditRow({ row }: { row: ConfigAuditRow }) {
  const fmt = (v: Partial<BiometricConfigRow> | null | undefined) =>
    v ? `1:1 ${v.verify_accept ?? '—'}/${v.verify_review ?? '—'} · 1:N ${v.identify_accept ?? '—'}/${v.identify_review ?? '—'} · m ${v.identify_margin ?? '—'} · k ${v.candidate_list_k ?? '—'}` : '—';
  return (
    <Card style={styles.card}>
      <View style={styles.head}><Text style={styles.title}>v{row.config_version} · {row.action}</Text><Text style={styles.meta}>{formatTimestamp(row.created_at)}</Text></View>
      {row.old_values ? <Text selectable style={styles.meta}>Old: {fmt(row.old_values)}</Text> : null}
      <Text selectable style={styles.meta}>New: {fmt(row.new_values)} · model {row.model_version}</Text>
      <Text selectable style={styles.meta}>By {row.actor_name} ({row.actor_role || 'system'}) · admin ID {row.actor_id ?? 'system'}</Text>
      <Text selectable style={styles.body}>Reason: {row.reason}</Text>
    </Card>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.value}>
      <Text style={styles.valueLabel}>{label}</Text>
      <Text selectable style={styles.valueText}>{value}</Text>
    </View>
  );
}

/** Opens / closes the user's controlled test session; scans made while it is open are stamped as that tier. */
export function TestSessionManager({ sessions, canRun, onChanged }: { sessions: TestSessionRow[]; canRun: boolean; onChanged: () => Promise<void> }) {
  const open = sessions.find((s) => s.own && s.status === 'open');
  const [form, setForm] = useState({ name: '', protocol: 'MOOZZLE-BPT-01 (ISO/IEC 19795-1 aligned)', tier: 'laboratory' as TestSessionRow['data_source'], split: 'evaluation' as TestSessionRow['dataset_split'], device: '', condition: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('open_test_session', {
        p: { name: form.name, protocol_reference: form.protocol, data_source: form.tier, dataset_split: form.split, device_model: form.device, capture_condition: form.condition },
      });
      if (rpcError) throw rpcError;
      await onChanged();
    } catch (caught) {
      console.error('Open test session failed', caught);
      setError(messageOf(caught, 'The test session could not be opened.'));
    } finally {
      setBusy(false);
    }
  }, [form, onChanged]);

  const close = useCallback(async () => {
    if (!open) return;
    setBusy(true);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('close_test_session', { p_id: open.id });
      if (rpcError) throw rpcError;
      await onChanged();
    } catch (caught) {
      console.error('Close test session failed', caught);
      setError(messageOf(caught, 'The test session could not be closed.'));
    } finally {
      setBusy(false);
    }
  }, [onChanged, open]);

  return (
    <View style={styles.stack}>
      {canRun && open ? (
        <Card style={styles.card}>
          <View style={styles.head}><Text style={styles.title}>Your open session: {open.name}</Text><Pill label="OPEN" tone="blue" /></View>
          <Text style={styles.meta}>{TIER_LABELS[open.data_source]} · {open.dataset_split} split · {open.protocol_reference}</Text>
          <Text style={styles.muted}>Every Identify / Verify scan you make is stamped with this tier. Label each one (genuine / impostor, mated / non-mated) in the Labels tab.</Text>
          <PrimaryButton label={busy ? 'Closing…' : 'Close Session'} variant="outline" onPress={() => void close()} disabled={busy} />
        </Card>
      ) : null}
      {canRun && !open ? (
        <Card style={styles.card}>
          <Text style={styles.title}>Start a controlled test session</Text>
          <TextField label="Session name" value={form.name} onChangeText={(name) => setForm((f) => ({ ...f, name }))} placeholder="e.g. Anand lab — evaluation batch 3" />
          <TextField label="Protocol reference" value={form.protocol} onChangeText={(protocol) => setForm((f) => ({ ...f, protocol }))} />
          <Text style={styles.kicker}>DATA TIER</Text>
          <View style={styles.chips}>
            <OptionChip label="Laboratory" selected={form.tier === 'laboratory'} onPress={() => setForm((f) => ({ ...f, tier: 'laboratory' }))} />
            <OptionChip label="Field pilot" selected={form.tier === 'field_pilot'} onPress={() => setForm((f) => ({ ...f, tier: 'field_pilot' }))} />
          </View>
          <Text style={styles.kicker}>DATASET SPLIT</Text>
          <View style={styles.chips}>
            <OptionChip label="Calibration" selected={form.split === 'calibration'} onPress={() => setForm((f) => ({ ...f, split: 'calibration' }))} tone="blue" />
            <OptionChip label="Independent evaluation" selected={form.split === 'evaluation'} onPress={() => setForm((f) => ({ ...f, split: 'evaluation' }))} tone="blue" />
          </View>
          <View style={styles.fieldRow}>
            <TextField label="Device (optional)" value={form.device} onChangeText={(device) => setForm((f) => ({ ...f, device }))} style={styles.field} />
            <TextField label="Condition (optional)" value={form.condition} onChangeText={(condition) => setForm((f) => ({ ...f, condition }))} style={styles.field} />
          </View>
          <PrimaryButton label={busy ? 'Opening…' : 'Open Test Session'} icon="flask-outline" onPress={() => void start()} disabled={busy || form.name.trim().length < 3} />
        </Card>
      ) : null}
      {!canRun ? <Text style={styles.muted}>Controlled test sessions are run by Researchers, Organisation Administrators or a privileged Super Administrator.</Text> : null}
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      {sessions.map((s) => (
        <Card key={s.id} style={styles.card}>
          <View style={styles.head}><Text style={styles.title}>{s.name}</Text><Pill label={s.status.toUpperCase()} tone={s.status === 'open' ? 'blue' : 'slate'} /></View>
          <Text style={styles.meta}>{TIER_LABELS[s.data_source]} · {s.dataset_split} · {s.protocol_reference} · opened {formatTimestamp(s.opened_at)}</Text>
          <Text style={styles.meta}>{s.subject_count} subject animal(s){s.device_model ? ` · ${s.device_model}` : ''}{s.capture_condition ? ` · ${s.capture_condition}` : ''}</Text>
          {s.subject_overlap > 0 ? (
            <View style={styles.leak}><Ionicons name="warning-outline" size={16} color={colors.danger} /><Text style={styles.leakText}>Dataset leakage: {s.subject_overlap} animal(s) also appear in a {s.dataset_split === 'evaluation' ? 'calibration' : 'evaluation'} session. Exclude them before reporting evaluation results.</Text></View>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1 },
  card: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15, flexShrink: 1 },
  section: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 8 },
  kicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  value: { flexGrow: 1, flexBasis: 140, backgroundColor: colors.slateLight, borderRadius: 10, padding: 10 },
  valueLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 11 },
  valueText: { color: colors.text, fontFamily: Fonts.bold, fontSize: 20, fontVariant: ['tabular-nums'] },
  meta: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  body: { color: colors.text, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13, lineHeight: 18 },
  fieldRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  field: { flexGrow: 1, flexBasis: 140 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  leak: { flexDirection: 'row', gap: 6, backgroundColor: colors.dangerLight, borderRadius: 10, padding: 10 },
  leakText: { flex: 1, color: colors.danger, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
});
