import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import {
  AppScreen,
  Card,
  colors,
  PageHeader,
  Pill,
  PrimaryButton,
  StorageGate,
} from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { useAppStore } from '@/store/useAppStore';
import type { SyncSummary } from '@/store/types';

type SyncState = 'idle' | 'syncing' | 'completed' | 'error';

export default function SyncScreen() {
  return (
    <StorageGate>
      <SyncContent />
    </StorageGate>
  );
}

function SyncContent() {
  const offlineMode = useAppStore((state) => state.offlineMode);
  const setOfflineMode = useAppStore((state) => state.setOfflineMode);
  const completeSync = useAppStore((state) => state.completeSync);
  const pendingRecords = useAppStore((state) => state.pendingSyncQueue.animalRecords);
  const pendingImages = useAppStore((state) => state.pendingSyncQueue.muzzleImages);
  const pendingEntries = useAppStore((state) => state.pendingSyncQueue.aiHealthEntries);
  const lastSyncSummary = useAppStore((state) => state.lastSyncSummary);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (syncState !== 'syncing') return undefined;

    const timer = setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + 20, 100);
        if (next === 100) {
          clearInterval(timer);
          const summary: SyncSummary = {
            recordsUploaded: pendingRecords,
            imagesUploaded: pendingImages,
            errors: 0,
            completedAt: new Date().toISOString(),
          };
          completeSync(summary);
          setSyncState('completed');
        }
        return next;
      });
    }, 420);

    return () => clearInterval(timer);
  }, [completeSync, pendingImages, pendingRecords, syncState]);

  const handleToggle = useCallback((value: boolean) => {
    try {
      setOfflineMode(value);
    } catch (caughtError) {
      console.error('Could not change offline mode', caughtError);
      setError('Offline mode could not be changed. Please try again.');
      setSyncState('error');
    }
  }, [setOfflineMode]);

  const handleSync = useCallback(() => {
    try {
      setError('');
      setProgress(0);
      setSyncState('syncing');
    } catch (caughtError) {
      console.error('Could not start synchronization', caughtError);
      setError('Synchronization could not start. Please try again.');
      setSyncState('error');
    }
  }, []);

  const handleBack = useCallback(() => router.back(), []);
  const hasPendingItems = pendingRecords + pendingImages + pendingEntries > 0;
  const displayedSummary = lastSyncSummary ?? (syncState === 'completed' ? null : undefined);

  return (
    <AppScreen scroll>
      <PageHeader eyebrow="Field operations" title="Sync Manager" onBack={handleBack} />
      <View style={styles.content}>
        <Card style={styles.modeCard}>
          <View style={styles.modeCopy}>
            <View style={styles.modeIcon}><Ionicons name={offlineMode ? 'cloud-offline-outline' : 'cloud-done-outline'} size={24} color={offlineMode ? colors.warning : colors.primary} /></View>
            <View style={styles.modeText}>
              <Text style={styles.cardTitle}>Offline Mode</Text>
              <Text style={styles.cardDescription}>{offlineMode ? 'New work stays on this device until the next sync.' : 'Online mode is active. Local work can be uploaded now.'}</Text>
            </View>
          </View>
          <View style={styles.switchRow}>
            <Pill label={offlineMode ? 'SIMULATED OFFLINE' : 'ONLINE'} tone={offlineMode ? 'amber' : 'green'} />
            <Switch accessibilityLabel="Toggle simulated offline mode" value={offlineMode} onValueChange={handleToggle} trackColor={{ false: '#CBD5E1', true: '#F7C873' }} thumbColor={offlineMode ? colors.warning : colors.primary} />
          </View>
        </Card>

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.eyebrow}>Local queue</Text>
            <Text style={styles.sectionTitle}>Waiting to upload</Text>
          </View>
          <Pill label={`${pendingRecords + pendingImages + pendingEntries} items`} tone={hasPendingItems ? 'blue' : 'green'} />
        </View>

        <Card style={styles.queueCard}>
          <QueueRow icon="paw-outline" label="Locally enrolled bovine records" value={pendingRecords} tone="green" />
          <QueueRow icon="images-outline" label="Muzzle image bundles" value={pendingImages} tone="blue" />
          <QueueRow icon="medkit-outline" label="Pending AI / health entries" value={pendingEntries} tone="amber" />
          <View style={styles.queueNote}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
            <Text style={styles.queueNoteText}>Queue stays available if connectivity drops during field work.</Text>
          </View>
        </Card>

        <Card style={styles.syncCard}>
          <View style={styles.syncHeader}>
            <View>
              <Text style={styles.eyebrow}>Server handoff</Text>
              <Text style={styles.cardTitle}>{syncState === 'syncing' ? 'SYNCING...' : syncState === 'completed' ? 'SYNC COMPLETED ✓' : 'Ready to sync'}</Text>
            </View>
            {syncState === 'syncing' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name={syncState === 'completed' ? 'checkmark-circle' : 'cloud-upload-outline'} size={28} color={syncState === 'completed' ? colors.accent : colors.primary} />}
          </View>
          {syncState === 'syncing' ? (
            <View style={styles.progressArea}>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
              <Text selectable style={styles.progressLabel}>{progress}% staged to central database</Text>
            </View>
          ) : null}
          <PrimaryButton disabled={syncState === 'syncing'} label={syncState === 'syncing' ? 'SYNCING...' : 'SYNC NOW'} icon="sync-outline" onPress={handleSync} />
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.summaryHeading}>
            <Text style={styles.cardTitle}>Latest sync output</Text>
            <Pill label={displayedSummary ? 'Recorded locally' : 'No completed sync'} tone={displayedSummary ? 'green' : 'slate'} />
          </View>
          <View style={styles.summaryGrid}>
            <SummaryMetric label="Records uploaded" value={displayedSummary ? displayedSummary.recordsUploaded : 0} />
            <SummaryMetric label="Images uploaded" value={displayedSummary ? displayedSummary.imagesUploaded : 0} />
            <SummaryMetric label="Errors" value={displayedSummary ? displayedSummary.errors : 0} danger={Boolean(displayedSummary?.errors)} />
          </View>
          <Text selectable style={styles.timestamp}>{displayedSummary ? `Completed ${formatTimestamp(displayedSummary.completedAt)}` : 'Run SYNC NOW to record a timestamp.'}</Text>
          <View style={styles.encryptionRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.warning} />
            <View style={styles.encryptionCopy}>
              <Text style={styles.encryptionTitle}>Local database encryption status</Text>
              <Text selectable style={styles.encryptionText}>Prototype storage only. An encrypted database adapter is required before production deployment.</Text>
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
      <Text style={styles.summaryLabel}>{label}: {value}</Text>
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
