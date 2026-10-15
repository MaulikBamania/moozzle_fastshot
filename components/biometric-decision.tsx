import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { Card, colors, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { DECISION_COPY } from '@/lib/biometric/decision';
import { REASON_GUIDANCE } from '@/lib/biometric/quality';
import { TIER_LABELS } from '@/lib/analytics/filters';
import { supabase } from '@/lib/supabase';
import { useAsyncResource } from '@/lib/use-async-resource';
import { type PendingScan, usePendingScans } from '@/store/usePendingScans';
import type { BiometricDecision, DataSource, MuzzleAnalysis, TestSessionRow } from '@/store/types';

const TONE = {
  green: { bg: colors.primary, icon: colors.accent, text: '#F0FDF4' },
  amber: { bg: colors.warning, icon: '#B45309', text: '#FFFBEB' },
  red: { bg: colors.danger, icon: '#B91C1C', text: '#FEF2F2' },
  slate: { bg: '#334155', icon: '#1E293B', text: '#F1F5F9' },
} as const;

/** Headline banner for one of the five outcomes. */
export function DecisionBanner({ decision, subtitle }: { decision: BiometricDecision; subtitle?: string }) {
  const copy = DECISION_COPY[decision];
  const tone = TONE[copy.tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: tone.bg }]}>
      <View style={[styles.bannerIcon, { backgroundColor: tone.icon }]}><Ionicons name={copy.icon} size={22} color={colors.surface} /></View>
      <View style={styles.flex}>
        <Text style={styles.bannerTitle}>{copy.title}</Text>
        <Text style={[styles.bannerSubtitle, { color: tone.text }]}>{subtitle ?? copy.summary}</Text>
      </View>
    </View>
  );
}

/** Configuration that produced the decision — shown with every comparison result. */
export function ConfigFootnote({ configVersion, modelVersion, dataSource, extra }: { configVersion: number | null | undefined; modelVersion: string | null | undefined; dataSource?: DataSource; extra?: string }) {
  return (
    <Text selectable style={styles.footnote}>
      Config v{configVersion ?? '—'} · {modelVersion ?? 'model —'}{dataSource ? ` · ${TIER_LABELS[dataSource]}` : ''}{extra ? ` · ${extra}` : ''} · logged to the audit trail
    </Text>
  );
}

/** Outcome 4: the frame failed the pre-check. Explains each cause and how to recapture in the field. */
export function QualityInsufficientPanel({ analysis, onRecapture }: { analysis: MuzzleAnalysis; onRecapture?: () => void }) {
  return (
    <View style={styles.stack}>
      <DecisionBanner decision="IMAGE_QUALITY_INSUFFICIENT" subtitle={analysis.status} />
      <Card style={styles.card}>
        <Text style={styles.kicker}>WHAT WENT WRONG · HOW TO FIX IT</Text>
        {analysis.reasons.map((reason, index) => (
          <View key={reason} style={styles.reasonRow}>
            <View style={styles.reasonNumber}><Text style={styles.reasonNumberText}>{index + 1}</Text></View>
            <View style={styles.flex}>
              <Text style={styles.reasonCause}>{REASON_GUIDANCE[reason].cause}</Text>
              <Text style={styles.reasonFix}>{REASON_GUIDANCE[reason].fix}</Text>
            </View>
          </View>
        ))}
        <View style={styles.tips}>
          <Text style={styles.tipsTitle}>Field recapture checklist</Text>
          <Text style={styles.tip}>• Restrain the head gently; wait for the animal to stand still.</Text>
          <Text style={styles.tip}>• Wipe the nose with a dry cloth; remove feed, rope or hands from view.</Text>
          <Text style={styles.tip}>• Shade from direct sun; avoid flash glare; face daylight in sheds.</Text>
          <Text style={styles.tip}>• Fill the oval from 15–25 cm and tap to focus before capturing.</Text>
        </View>
        <Text style={styles.muted}>This frame was not compared with any enrolled animal and is reported as an acquisition failure (FTA), not as a match or non-match.</Text>
      </Card>
      {onRecapture ? <PrimaryButton label="RECAPTURE MUZZLE" icon="camera-outline" onPress={onRecapture} /> : null}
    </View>
  );
}

/** Outcome 5: the AI detector, storage or matching server could not be reached. */
export function ServiceUnavailablePanel({ message, onRetry, onQueue, queued, retrying }: { message: string; onRetry?: () => void; onQueue?: () => void; queued?: boolean; retrying?: boolean }) {
  return (
    <View style={styles.stack}>
      <DecisionBanner decision="SERVICE_UNAVAILABLE" />
      <Card style={styles.card}>
        <View style={styles.reasonRow}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.muted} />
          <Text selectable style={[styles.flex, styles.reasonCause]}>{message}</Text>
        </View>
        <Text style={styles.muted}>No identity was claimed and no animal was registered. Retry when the connection returns, or hold this capture in the pending queue and process it later.</Text>
        <View style={styles.row}>
          {onRetry ? <PrimaryButton label={retrying ? 'Retrying…' : 'Retry Now'} icon="refresh-outline" variant="outline" onPress={onRetry} disabled={retrying} style={styles.flex} /> : null}
          {onQueue ? <PrimaryButton label={queued ? 'Added to Pending' : 'Add to Pending Queue'} icon="time-outline" variant="soft" onPress={onQueue} disabled={queued} style={styles.flex} /> : null}
        </View>
      </Card>
    </View>
  );
}

/** Captures waiting for the service; processed one at a time on demand. */
export function PendingScansCard({ operation, online, busy, onProcess }: { operation: PendingScan['operation']; online: boolean; busy: boolean; onProcess: (item: PendingScan) => void }) {
  const items = usePendingScans((state) => state.items).filter((item) => item.operation === operation);
  const remove = usePendingScans((state) => state.remove);
  if (items.length === 0) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.pendingHead}>
        <Ionicons name="time-outline" size={18} color={colors.blue} />
        <Text style={[styles.flex, styles.pendingTitle]}>Pending scans ({items.length})</Text>
      </View>
      <Text style={styles.muted}>Held in memory on this device only (cleared when the app closes) because muzzle images are sensitive. Each one is analysed and compared from the start when processed.</Text>
      {items.map((item) => (
        <View key={item.id} style={styles.pendingRow}>
          <Text style={styles.pendingLabel}>{operation === 'verify' ? `1:1 verify · ${item.claimedId ?? ''}` : '1:N identify'} · {new Date(item.queuedAt).toLocaleTimeString()}</Text>
          {item.lastError ? <Text selectable style={styles.pendingError}>{item.lastError}</Text> : null}
          <View style={styles.row}>
            <PrimaryButton label="Process" icon="play-outline" variant="outline" onPress={() => onProcess(item)} disabled={!online || busy} style={[styles.flex, styles.pendingButton]} />
            <PrimaryButton label="Discard" variant="soft" onPress={() => remove(item.id)} disabled={busy} style={[styles.flex, styles.pendingButton]} />
          </View>
        </View>
      ))}
      {!online ? <Text style={styles.muted}>Reconnect to process pending scans.</Text> : null}
    </Card>
  );
}

/** Banner when the user has an open controlled test session: their scans are stamped as lab / field-pilot data. */
export function TestSessionBanner() {
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_test_session');
    if (error) throw error;
    return (data as TestSessionRow | null) ?? null;
  }, []);
  // A failed lookup only hides this informational banner; scans are still stamped server-side.
  const { data: session } = useAsyncResource(load, 'Test session lookup failed');
  if (!session) return null;
  return (
    <View style={styles.session}>
      <Ionicons name="flask-outline" size={18} color="#6D28D9" />
      <Text style={styles.sessionText}>TEST PROTOCOL ACTIVE · {TIER_LABELS[session.data_source]} · {session.dataset_split} split · “{session.name}”. Scans are recorded as labelled-trial data, not production.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  card: { gap: 10 },
  banner: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 15, letterSpacing: 0.4 },
  bannerSubtitle: { fontFamily: Fonts.medium, fontSize: 12, marginTop: 2, lineHeight: 17 },
  footnote: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16 },
  kicker: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  reasonRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  reasonNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' },
  reasonNumberText: { color: '#B45309', fontFamily: Fonts.bold, fontSize: 12 },
  reasonCause: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14, lineHeight: 19 },
  reasonFix: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  tips: { backgroundColor: colors.slateLight, borderRadius: 12, padding: 12, gap: 4 },
  tipsTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 13, marginBottom: 2 },
  tip: { color: colors.text, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  pendingRow: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  pendingLabel: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  pendingError: { color: colors.danger, fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
  pendingButton: { minHeight: 44 },
  session: { flexDirection: 'row', gap: 8, backgroundColor: '#EDE9FE', borderRadius: 12, padding: 12 },
  sessionText: { flex: 1, color: '#5B21B6', fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
});
