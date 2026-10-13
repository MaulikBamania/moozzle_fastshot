import { StyleSheet } from 'react-native';
import { Text } from '@/components/translated-text';
import { StackScreen } from '@/components/app-chrome';
import { Card, colors, DataGate } from '@/components/moozzle-ui';
import { PerformanceDashboard } from '@/components/performance-dashboard';
import { ModelMatrix } from '@/components/validation-suite';
import { Fonts } from '@/constants/Typography';
import { useAppStore } from '@/store/useAppStore';

export default function PerformanceScreen() {
  return (
    <DataGate>
      <StackScreen title="Model Performance" eyebrow="Validation · thresholds · ISO/IEC 19795-1" destination="performance">
        <PerformanceDashboard initialTab="verification" />
        <ModelMatrix measuredMs={null} />
        <LegacyTrials />
      </StackScreen>
    </DataGate>
  );
}

/** Aggregate trial notes typed on this device before labelled per-comparison trials existed. Shown, never computed into rates. */
function LegacyTrials() {
  const trials = useAppStore((state) => state.validationTrials);
  if (trials.length === 0) return null;
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Legacy device-local trial notes ({trials.length})</Text>
      <Text style={styles.muted}>Entered as aggregate counts on this device. They are not per-comparison labelled trials, mixed 1:1 and 1:N attempts, and are excluded from every metric above.</Text>
      {trials.map((trial) => (
        <Text key={trial.id} selectable style={styles.row}>{trial.date} · {trial.location} · {trial.breed} · {trial.animals_count} animals · {trial.verification_attempts} verifications · {trial.identification_attempts} identifications · {trial.device_model}</Text>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  muted: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  row: { color: colors.text, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
});
