import { StackScreen } from '@/components/app-chrome';
import { DataGate } from '@/components/moozzle-ui';
import { PerformanceDashboard } from '@/components/performance-dashboard';

export default function AnalyticsScreen() {
  return (
    <DataGate>
      <StackScreen title="Biometric Scan Analytics" eyebrow="1:1 FAR/FRR · 1:N FPIR/FNIR · FTA/FTE" destination="analytics">
        <PerformanceDashboard initialTab="quality" />
      </StackScreen>
    </DataGate>
  );
}
