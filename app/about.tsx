import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  AppScreen,
  BrandWordmark,
  Card,
  colors,
  PageHeader,
  PrimaryButton,
  StorageGate,
} from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';

const PIPELINE = [
  ['Muzzle Image', 'Capture a clear close-up without relying on a physical tag.'],
  ['Quality Assessment', 'Reject blur, poor lighting, or incomplete muzzle views.'],
  ['Muzzle Detection', 'Locate and isolate the biometric region.'],
  ['Biometric Feature Extraction', 'Convert ridge, wrinkle, bump, and texture patterns into features.'],
  ['Biometric Template', 'Create a comparison-ready representation for the animal.'],
  ['Secure Database', 'Keep animal biometrics separate from owner personally identifiable information.'],
  ['12-Digit MOOZZLE ID', 'Assign a digital identity that can be retrieved in the field.'],
  ['Field Identification', 'Scan again and open the animal record when the match is validated.'],
] as const;

const VALUE_POINTS = [
  ['Non-invasive identity', 'Muzzle ridge identification works from a smartphone or tablet image and does not require a physical device on the animal.'],
  ['A record that travels', 'One digital identity can connect registration, health, AI, insurance, and movement records.'],
  ['Built for field reality', 'Offline-first workflows help field workers continue in low-connectivity farms and villages.'],
] as const;

const LIMITATION = 'MOOZZLE is a biometric identification technology concept and prototype. Biometric accuracy, FAR, FRR, latency, breed coverage, and field performance must be established through controlled and independent validation using representative cattle and buffalo datasets.';
const DPDP_STATEMENT = 'Designed with DPDP Act 2023 compliance requirements in mind. Final legal compliance requires organisational and legal review.';

export default function AboutScreen() {
  return (
    <StorageGate>
      <AboutContent />
    </StorageGate>
  );
}

function AboutContent() {
  const handleBack = useCallback(() => router.back(), []);
  const openPerformance = useCallback(() => router.push('/performance'), []);
  const openApiDocs = useCallback(() => router.push('/api-docs'), []);

  return (
    <AppScreen scroll>
      <PageHeader eyebrow="System guide" title="About MOOZZLE" onBack={handleBack} />
      <View style={styles.content}>
        <Card style={styles.brandCard}>
          <BrandWordmark width={260} />
          <Text style={styles.tagline}>One Muzzle. One Identity. One Digital Record.</Text>
          <Text style={styles.brandDescription}>A bovine biometric identification concept for cattle and buffalo field operations.</Text>
        </Card>

        <SectionHeading eyebrow="Why MOOZZLE" title="Business value" />
        <Card style={styles.valueCard}>
          {VALUE_POINTS.map(([title, description], index) => (
            <View key={title} style={styles.valueRow}>
              <View style={styles.valueNumber}><Text style={styles.valueNumberText}>{String(index + 1).padStart(2, '0')}</Text></View>
              <View style={styles.valueCopy}><Text style={styles.valueTitle}>{title}</Text><Text style={styles.bodyText}>{description}</Text></View>
            </View>
          ))}
          <View style={styles.comparisonBox}>
            <Ionicons name="swap-horizontal-outline" size={21} color={colors.primary} />
            <Text selectable style={styles.comparisonText}>Unlike ear tags or RFID tags, the biometric signal is part of the animal&apos;s muzzle and does not depend on a separate physical identifier.</Text>
          </View>
        </Card>

        <SectionHeading eyebrow="From image to identity" title="How MOOZZLE works" />
        <Card style={styles.pipelineCard}>
          {PIPELINE.map(([title, description], index) => <PipelineStep key={title} title={title} description={description} index={index} last={index === PIPELINE.length - 1} />)}
        </Card>

        <SectionHeading eyebrow="Section 24 & 25" title="Data security & DPDP Act 2023" />
        <Card style={styles.securityCard}>
          <SecurityRow icon="finger-print-outline" title="Biometric separation" text="Animal biometric information is separated from owner/personally identifiable information." />
          <SecurityRow icon="list-outline" title="Audit trails" text="Record access, changes, retirement, and synchronisation events for accountable operations." />
          <SecurityRow icon="lock-closed-outline" title="Data minimisation" text="Use only the operational information needed to identify and manage the animal record." />
          <View style={styles.legalBox}><Text selectable style={styles.legalText}>{DPDP_STATEMENT}</Text></View>
        </Card>

        <Card style={styles.limitCard}>
          <View style={styles.limitHeader}><Ionicons name="warning-outline" size={22} color={colors.warning} /><Text style={styles.limitTitle}>Technology limitation statement</Text></View>
          <Text selectable style={styles.limitText}>{LIMITATION}</Text>
        </Card>

        <View style={styles.actions}>
          <PrimaryButton label="OPEN PERFORMANCE DASHBOARD" icon="analytics-outline" onPress={openPerformance} />
          <PrimaryButton label="OPEN API CONSOLE" variant="outline" icon="code-slash-outline" onPress={openApiDocs} />
        </View>
      </View>
    </AppScreen>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View>;
}

function PipelineStep({ title, description, index, last }: { title: string; description: string; index: number; last: boolean }) {
  return (
    <View style={styles.pipelineRow}>
      <View style={styles.pipelineRail}><View style={styles.pipelineNode}><Text style={styles.pipelineNodeText}>{index + 1}</Text></View>{!last ? <View style={styles.pipelineLine} /> : null}</View>
      <View style={styles.pipelineCopy}><Text style={styles.pipelineTitle}>{title}</Text><Text style={styles.bodyText}>{description}</Text></View>
    </View>
  );
}

function SecurityRow({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  return <View style={styles.securityRow}><View style={styles.securityIcon}><Ionicons name={icon} size={19} color={colors.primary} /></View><View style={styles.securityCopy}><Text style={styles.valueTitle}>{title}</Text><Text style={styles.bodyText}>{text}</Text></View></View>;
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  brandCard: { alignItems: 'center', backgroundColor: '#123A2A', borderColor: '#123A2A', paddingVertical: 25, gap: 7 },
  tagline: { color: '#BDECCB', fontFamily: Fonts.semiBold, fontSize: 13, textAlign: 'center' },
  brandDescription: { color: '#D2E9DB', fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  eyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase' },
  sectionHeading: { gap: 2, paddingHorizontal: 2 },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 23 },
  valueCard: { gap: 16 },
  valueRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  valueNumber: { width: 35, height: 35, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  valueNumberText: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11 },
  valueCopy: { flex: 1, gap: 3 },
  valueTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  bodyText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  comparisonBox: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 13, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  comparisonText: { flex: 1, color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 12, lineHeight: 18 },
  pipelineCard: { gap: 0 },
  pipelineRow: { flexDirection: 'row', minHeight: 65, gap: 12 },
  pipelineRail: { width: 31, alignItems: 'center' },
  pipelineNode: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pipelineNodeText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 11 },
  pipelineLine: { width: 2, flex: 1, backgroundColor: '#B8DEC3', marginVertical: 3 },
  pipelineCopy: { flex: 1, paddingBottom: 13, gap: 2 },
  pipelineTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  securityCard: { gap: 15 },
  securityRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  securityIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  securityCopy: { flex: 1, gap: 3 },
  legalBox: { borderRadius: 12, backgroundColor: '#EFF8F1', padding: 12, borderWidth: 1, borderColor: '#CAE8D4' },
  legalText: { color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 12, lineHeight: 18 },
  limitCard: { backgroundColor: colors.warningLight, borderColor: '#F8D898', gap: 9 },
  limitHeader: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  limitTitle: { color: '#92400E', fontFamily: Fonts.bold, fontSize: 14 },
  limitText: { color: '#78350F', fontFamily: Fonts.medium, fontSize: 12, lineHeight: 19 },
  actions: { gap: 10 },
});
