import { StackScreen } from '@/components/app-chrome';
import { DataGate } from '@/components/moozzle-ui';
import { ScanAnalytics } from '@/components/scan-analytics';

export default function AnalyticsScreen() {
  return (
    <DataGate>
      <StackScreen title="Biometric Scan Analytics" eyebrow="FRR / FAR Report" destination="analytics">
        <ScanAnalytics />
      </StackScreen>
    </DataGate>
  );
}
