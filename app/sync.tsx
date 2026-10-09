import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import {
  AppScreen,
  Card,
  colors,
  PageHeader,
  Pill,
  PrimaryButton,
  DataGate,
} from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { useAppStore } from '@/store/useAppStore';
import { loadBovineData, messageOf, syncQueuedOperations, useBovineStore } from '@/store/useBovineStore';
import { useConnectivity, useIsOnline } from '@/store/useConnectivity';

type SyncState = 'idle' | 'syncing' | 'completed' | 'error';

export default function SyncScreen() {
  return (
    <DataGate>
      <SyncContent />
    </DataGate>
  );
}

function SyncContent() {
  const offlineMode = useAppStore((state) => state.offlineMode);
  const setOfflineMode = useAppStore((state) => state.setOfflineMode);
  const syncQueue = useAppStore((state) => state.syncQueue);
  const lastSyncSummary = useAppStore((state) => state.lastSyncSummary);
  const userId = useBovineStore((state) => state.userId);
  const reachable = useConnectivity((state) => state.reachable);
  const checking = useConnectivity((state) => state.checking);
  const lastCheckedAt = useConnectivity((state) => state.lastCheckedAt);
  const online = useIsOnline();
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [error, setError] = useState('');

  const queue = useMemo(() => syncQueue.filter((op) => op.userId === userId), [syncQueue, userId]);
  const pendingRecords = useMemo(() => queue.filter((op) => op.kind === 'animal').length, [queue]);
  const pendingImages = pendingRecords;
  const pendingEntries = useMemo(() => queue.filter((op) => op.kind !== 'animal').length, [queue]);

  const handleToggle = useCallback((value: boolean) => {
    setOfflineMode(value);
    setError('');
  }, [setOfflineMode]);

  const handleCheck = useCallback(async () => {
    try {
      const ok = await useConnectivity.getState().check();
      if (ok) await loadBovineData();
    } catch (caughtError) {
      console.error('Connectivity check failed', caughtError);
      setError('The connection check could not run. Please try again.');
    }
  }, []);

  const handleSync = useCallback(async () => {
    setError('');
    setSyncState('syncing');
    try {
      const ok = await useConnectivity.getState().check();
      if (!ok) throw new Error('Supabase is unreachable. Check your network and try again.');
      const summary = await syncQueuedOperations();
      if (summary.errors > 0) {
        setError(`${summary.errors} item(s) could not be uploaded and remain queued. Retry when the connection is stable.`);
        setSyncState('error');
      } else {
        setSyncState('completed');
      }
    } catch (caughtError) {
      console.error('Sync failed', caughtError);
      setError(messageOf(caughtError, 'Synchronization failed. Your queued records are still on this device.'));
      setSyncState('error');
    }
  }, []);

  const handleBack = useCallback(() => router.back(), []);
  const pendingTotal = queue.length;
  const hasPendingItems = pendingTotal > 0;
  const connectionLabel = offlineMode ? 'OFFLINE MODE' : reachable === false ? 'UNREACHABLE' : reachable ? 'SUPABASE ONLINE' : 'CHECKING…';

  return (
    <AppScreen scroll>
      <PageHeader eyebrow="Field operations" title="Sync Manager" onBack={handleBack} />
      <View style={styles.content}>
        <Card style={styles.modeCard}>
          <View style={styles.modeCopy}>
            <View style={styles.modeIcon}><Ionicons name={online ? 'cloud-done-outline' : 'cloud-offline-outline'} size={24} color={online ? colors.primary : colors.warning} /></View>
            <View style={styles.modeText}>
              <Text style={styles.cardTitle}>Offline Mode</Text>
              <Text style={styles.cardDescription}>{offlineMode ? 'New work is queued on this device until you sync.' : reachable === false ? 'Supabase cannot be reached. New work is queued automatically.' : 'Connected. New work is saved straight to your cloud archive.'}</Text>
            </View>
          </View>
          <View style={styles.switchRow}>
            <Pill label={connectionLabel} tone={online ? 'green' : 'amber'} />
            <Switch accessibilityLabel="Toggle offline mode" value={offlineMode} onValueChange={handleToggle} trackColor={{ false: '#CBD5E1', true: '#F7C873' }} thumbColor={offlineMode ? colors.warning : colors.primary} />
          </View>
          <View style={styles.checkRow}>
            <Text selectable style={styles.queueNoteText}>{lastCheckedAt ? `Last connection check ${formatTimestamp(lastCheckedAt)}` : 'Checking connection…'}</Text>
            <PrimaryButton label={checking ? 'Checking…' : 'Check Now'} variant="soft" icon="pulse-outline" onPress={() => void handleCheck()} disabled={checking} style={styles.checkButton} />
          </View>
        </Card>

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.eyebrow}>Local queue</Text>
            <Text style={styles.sectionTitle}>Waiting to upload</Text>
          </View>
          <Pill label={`${pendingTotal} items`} tone={hasPendingItems ? 'blue' : 'green'} />
        </View>

        <Card style={styles.queueCard}>
          <QueueRow icon="paw-outline" label="Offline-enrolled bovine records" value={pendingRecords} tone="green" />
          <QueueRow icon="finger-print-outline" label="Biometric templates" value={pendingImages} tone="blue" />
          <QueueRow icon="medkit-outline" label="AI / health / insurance / retirement entries" value={pendingEntries} tone="amber" />
          <View style={styles.queueNote}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
            <Text style={styles.queueNoteText}>{hasPendingItems ? 'Queued items are stored on this device for your account only.' : 'Nothing is waiting. Everything you recorded is in Supabase.'}</Text>
          </View>
        </Card>

        <Card style={styles.syncCard}>
          <View style={styles.syncHeader}>
            <View>
              <Text style={styles.eyebrow}>Server handoff</Text>
              <Text style={styles.cardTitle}>{syncState === 'syncing' ? 'SYNCING...' : syncState === 'completed' ? 'SYNC COMPLETED ✓' : hasPendingItems ? 'Ready to sync' : 'Up to date'}</Text>
            </View>
            {syncState === 'syncing' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name={syncState === 'completed' || !hasPendingItems ? 'checkmark-circle' : 'cloud-upload-outline'} size={28} color={syncState === 'completed' || !hasPendingItems ? colors.accent : colors.primary} />}
          </View>
          <PrimaryButton disabled={syncState === 'syncing' || !hasPendingItems || offlineMode} label={syncState === 'syncing' ? 'SYNCING...' : offlineMode ? 'TURN OFF OFFLINE MODE TO SYNC' : 'SYNC NOW'} icon="sync-outline" onPress={() => void handleSync()} />
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.summaryHeading}>
            <Text style={styles.cardTitle}>Latest sync output</Text>
            <Pill label={lastSyncSummary ? (lastSyncSummary.errors > 0 ? 'Partial' : 'Uploaded') : 'No completed sync'} tone={lastSyncSummary ? (lastSyncSummary.errors > 0 ? 'amber' : 'green') : 'slate'} />
          </View>
          <View style={styles.summaryGrid}>
            <SummaryMetric label="Records uploaded" value={lastSyncSummary?.recordsUploaded ?? 0} />
            <SummaryMetric label="Templates uploaded" value={lastSyncSummary?.imagesUploaded ?? 0} />
            <SummaryMetric label="Errors" value={lastSyncSummary?.errors ?? 0} danger={Boolean(lastSyncSummary?.errors)} />
          </View>
          <Text selectable style={styles.timestamp}>{lastSyncSummary ? `Completed ${formatTimestamp(lastSyncSummary.completedAt)}` : 'Run SYNC NOW after offline work to record a timestamp.'}</Text>
          <View style={styles.encryptionRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.warning} />
            <View style={styles.encryptionCopy}>
              <Text style={styles.encryptionTitle}>Local queue encryption status</Text>
              <Text selectable style={styles.encryptionText}>Cloud records are protected by per-account row-level security. The on-device queue uses plain app storage; an encrypted adapter is required before production.</Text>
            </View>
          </View>
        </Card>
      </View>
    </AppScreen>
  );
}

function QueueRow({ icon, label, value, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number; tone: 'green' | 'blue' | 'amber' }) {
  const iconColor = tone === 'blue' ? colors.blue : tone === 'amber' ? colors.warning : colors.primary;
  return (
    <View style={styles.queueRow}>
      <View style={[styles.queueIcon, { backgroundColor: tone === 'blue' ? colors.blueLight : tone === 'amber' ? colors.warningLight : colors.primaryLight }]}><Ionicons name={icon} size={19} color={iconColor} /></View>
      <Text style={styles.queueLabel}>{label}</Text>
      <Text selectable style={[styles.queueValue, { color: iconColor }]}>{value}</Text>
    </View>
  );
}

function SummaryMetric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <View style={styles.summaryMetric}>
      <Text selectable style={[styles.summaryValue, danger && styles.dangerValue]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  modeCard: { gap: 14, backgroundColor: '#FBFFFC', borderColor: '#D6E9DE' },
  modeCopy: { flexDirection: 'row', gap: 11, alignItems: 'center' },
  modeIcon: { width: 45, height: 45, borderRadius: 14, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  modeText: { flex: 1, gap: 4 },
  cardTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17 },
  cardDescription: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkButton: { minHeight: 44, paddingHorizontal: 12 },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 2 },
  eyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase' },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 23 },
  queueCard: { gap: 14 },
  queueRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  queueIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  queueLabel: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13 },
  queueValue: { fontFamily: Fonts.bold, fontSize: 20, fontVariant: ['tabular-nums'] },
  queueNote: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, flexDirection: 'row', gap: 7, alignItems: 'center' },
  queueNoteText: { flex: 1, color: colors.muted, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 16 },
  syncCard: { gap: 15, backgroundColor: '#F1FBF5', borderColor: '#CAE8D4' },
  syncHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressArea: { gap: 7 },
  progressTrack: { height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: '#D5E8DB' },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: colors.primary },
  progressLabel: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 11 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  summaryCard: { gap: 14 },
  summaryHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  summaryGrid: { flexDirection: 'row', gap: 8 },
  summaryMetric: { flex: 1, minHeight: 78, borderRadius: 12, backgroundColor: colors.slateLight, padding: 9, justifyContent: 'center', gap: 3 },
  summaryValue: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 26, fontVariant: ['tabular-nums'] },
  dangerValue: { color: colors.danger },
  summaryLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 10, lineHeight: 13 },
  timestamp: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11 },
  encryptionRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  encryptionCopy: { flex: 1, gap: 3 },
  encryptionTitle: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  encryptionText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 16 },
});
