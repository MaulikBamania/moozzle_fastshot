import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { retryLoading, useAppStore } from '@/store/useAppStore';
import { continueOffline, loadBovineData, useBovineStore } from '@/store/useBovineStore';
import { useStorageStatus } from '@/store/storage';
import type { Animal, Language } from '@/store/types';
import { Fonts } from '@/constants/Typography';

export const colors = {
  primary: '#1B5E20',
  accent: '#2E7D32',
  primaryLight: '#E8F5E9',
  surface: '#FFFFFF',
  background: '#F8FAFC',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  warning: '#D97706',
  warningLight: '#FEF3C7',
  danger: '#DC2626',
  dangerLight: '#FEE2E2',
  blue: '#0284C7',
  blueLight: '#E0F2FE',
  slateLight: '#F1F5F9',
} as const;

const girPhoto = require('../assets/design/photo-gir-cow-37fd7402.jpg');
const murrahPhoto = require('../assets/design/photo-murrah-buffalo-c3170d28.jpg');

const translations: Record<Language, Record<string, string>> = {
  EN: {
    home: 'Home',
    identify: 'Identify',
    records: 'Records',
    verify: 'Verify',
    register: 'REGISTER ANIMAL',
    identifyAnimal: 'IDENTIFY ANIMAL',
    animalRecords: 'ANIMAL RECORDS',
    verifyAnimal: 'VERIFY ANIMAL',
    offline: 'OFFLINE MODE',
    next: 'Next',
    retry: 'Retry',
    online: 'ONLINE • Cloud Sync',
    fieldTip: 'Field Tip',
  },
  HI: {
    home: 'होम',
    identify: 'पहचानें',
    records: 'रिकॉर्ड',
    verify: 'सत्यापित करें',
    register: 'पशु पंजीकृत करें',
    identifyAnimal: 'पशु पहचानें',
    animalRecords: 'पशु रिकॉर्ड',
    verifyAnimal: 'पशु सत्यापित करें',
    offline: 'ऑफलाइन मोड',
    next: 'आगे',
    retry: 'फिर कोशिश करें',
    online: 'ऑनलाइन · क्लाउड सिंक',
    fieldTip: 'मैदानी सुझाव',
  },
  GU: {
    home: 'હોમ',
    identify: 'ઓળખો',
    records: 'રેકોર્ડ',
    verify: 'ચકાસો',
    register: 'પશુ નોંધણી કરો',
    identifyAnimal: 'પશુ ઓળખો',
    animalRecords: 'પશુ રેકોર્ડ',
    verifyAnimal: 'પશુ ચકાસો',
    offline: 'ઓફલાઇન મોડ',
    next: 'આગળ',
    retry: 'ફરી પ્રયાસ કરો',
    online: 'ઓનલાઇન · ક્લાઉડ સિંક',
    fieldTip: 'ફિલ્ડ સૂચન',
  },
};

export const tr = (language: Language, key: string): string => translations[language][key] ?? translations.EN[key] ?? key;

export function formatMoozzleId(id: string): string {
  return id.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
}

/** Species reference artwork (the prototype does not upload muzzle photos). */
export function getAnimalImageSource(animalType: Animal['animal_type'] | undefined): number {
  return animalType === 'Buffalo' ? murrahPhoto : girPhoto;
}

export function AppScreen({ children, scroll = false }: { children: React.ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const content = scroll ? (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.flex}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  return <View style={[styles.page, { paddingTop: insets.top }]}>{content}</View>;
}

/** Waits for device preferences and the offline queue. */
export function StorageGate({ children }: { children: React.ReactNode }) {
  const status = useStorageStatus();
  if (status.phase === 'loading') return <LoadingState label="Loading device settings…" />;
  if (status.phase === 'error') return <ErrorState message="Device settings and the offline queue could not be loaded." onRetry={retryLoading} />;
  return <>{children}</>;
}

/** Waits for device storage plus this account's bovine records from Supabase. */
export function DataGate({ children }: { children: React.ReactNode }) {
  const storagePhase = useStorageStatus((state) => state.phase);
  const phase = useBovineStore((state) => state.phase);
  const error = useBovineStore((state) => state.error);
  if (storagePhase === 'loading') return <LoadingState label="Loading device settings…" />;
  if (storagePhase === 'error') return <ErrorState message="Device settings and the offline queue could not be loaded." onRetry={retryLoading} />;
  if (phase === 'idle' || phase === 'loading') return <LoadingState label="Loading your bovine records…" />;
  if (phase === 'error') {
    return (
      <ErrorState
        message={`${error ?? 'Your bovine records could not be loaded.'} Check your connection and retry, or continue offline with queued work.`}
        onRetry={() => void loadBovineData()}
        secondaryLabel="Continue Offline"
        onSecondary={continueOffline}
      />
    );
  }
  return <>{children}</>;
}

export function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.stateScreen}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.stateLabel}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry, secondaryLabel, onSecondary }: { message: string; onRetry: () => void; secondaryLabel?: string; onSecondary?: () => void }) {
  return (
    <View style={styles.stateScreen}>
      <View style={styles.errorIcon}>
        <Ionicons name="alert-circle-outline" size={26} color={colors.danger} />
      </View>
      <Text selectable style={styles.errorTitle}>Something needs attention</Text>
      <Text selectable style={styles.stateLabel}>{message}</Text>
      <PrimaryButton label="Retry" onPress={onRetry} variant="outline" />
      {secondaryLabel && onSecondary ? <PrimaryButton label={secondaryLabel} onPress={onSecondary} variant="soft" /> : null}
    </View>
  );
}

export function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.logoMark, compact && styles.logoMarkCompact]}>
      <Ionicons name="finger-print-outline" size={compact ? 23 : 31} color={colors.surface} />
      {!compact && <Text style={styles.logoMarkText}>M</Text>}
    </View>
  );
}

export function BiometricScanIcon({ size = 28, color = colors.surface }: { size?: number; color?: string }) {
  return (
    <View style={[styles.biometricScanIcon, { width: size, height: size }]}>
      <Ionicons name="scan-outline" size={size} color={color} style={StyleSheet.absoluteFill} />
      <Ionicons name="finger-print-outline" size={size * 0.68} color={color} />
    </View>
  );
}

export function AccountButton() {
  const profile = useBovineStore((state) => state.profile);
  const name = profile?.full_name?.trim() || 'Account';
  const initials = name === 'Account' ? '' : name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open account for ${name}`}
      onPress={() => router.push('/profile')}
      hitSlop={8}
      style={({ pressed }) => [styles.accountButton, pressed && styles.buttonPressed]}
    >
      {initials ? <Text style={styles.accountInitials}>{initials}</Text> : <Ionicons name="person" size={15} color={colors.surface} />}
    </Pressable>
  );
}

export function AppHeader({ language, onLanguageChange, onNetworkPress, offline = false }: { language: Language; onLanguageChange: (value: Language) => void; onNetworkPress?: () => void; offline?: boolean }) {
  return (
    <View style={styles.appHeader}>
      <View style={styles.brandRow}>
        <LogoMark />
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>MOOZZLE</Text>
          <Text numberOfLines={2} style={styles.brandSubtitle}>Bovine Biometric Identification</Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <View style={styles.languageRow}>
          <AccountButton />
          {(['EN', 'HI', 'GU'] as Language[]).map((item, index) => (
            <View style={styles.languageItem} key={item}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: language === item }}
                onPress={() => onLanguageChange(item)}
                hitSlop={8}
              >
                <Text style={[styles.languageText, language === item && styles.languageActive]}>{item}</Text>
              </Pressable>
              {index < 2 && <Text style={styles.languageDivider}>|</Text>}
            </View>
          ))}
        </View>
        {onNetworkPress ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Open offline sync manager" onPress={onNetworkPress} style={[styles.networkChip, offline && styles.networkChipOffline]}>
            <View style={[styles.onlineDot, offline && styles.offlineDot]} />
            <Text adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} style={[styles.networkText, offline && styles.networkTextOffline]}>{tr(language, offline ? 'offline' : 'online')}</Text>
            <Ionicons name="chevron-forward" size={13} color={offline ? colors.warning : colors.primary} />
          </Pressable>
        ) : (
          <View style={[styles.networkChip, offline && styles.networkChipOffline]}>
            <View style={[styles.onlineDot, offline && styles.offlineDot]} />
            <Text adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} style={[styles.networkText, offline && styles.networkTextOffline]}>{tr(language, offline ? 'offline' : 'online')}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function PageHeader({ title, eyebrow, onBack }: { title: string; eyebrow?: string; onBack?: () => void }) {
  return (
    <View style={styles.pageHeader}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} hitSlop={8} style={styles.backButton}>
          <Ionicons name="arrow-back" size={21} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.pageHeaderCopy}>
        {eyebrow ? <Text style={styles.pageHeaderEyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.pageHeaderTitle}>{title}</Text>
      </View>
    </View>
  );
}

type TabName = 'home' | 'identify' | 'records' | 'verify';

export function BottomNav({ active }: { active: TabName }) {
  const insets = useSafeAreaInsets();
  const handleNavigate = useCallback((tab: TabName) => {
    const routes: Record<TabName, string> = {
      home: '/(tabs)',
      identify: '/(tabs)/identify',
      records: '/(tabs)/records',
      verify: '/(tabs)/verify',
    };
    router.replace(routes[tab] as never);
  }, []);
  const language = useAppStore((state) => state.language);
  const items: { key: TabName; icon?: keyof typeof Ionicons.glyphMap; biometric?: boolean; label: string }[] = [
    { key: 'home', icon: 'home', label: tr(language, 'home') },
    { key: 'identify', biometric: true, label: tr(language, 'identify') },
    { key: 'records', icon: 'document-text-outline', label: tr(language, 'records') },
    { key: 'verify', icon: 'shield-checkmark-outline', label: tr(language, 'verify') },
  ];

  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((item) => (
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: active === item.key }}
          accessibilityLabel={item.label}
          key={item.key}
          onPress={() => handleNavigate(item.key)}
          style={styles.tabButton}
        >
          {item.biometric ? <BiometricScanIcon size={28} color={active === item.key ? colors.primary : colors.muted} /> : <Ionicons name={item.icon ?? 'ellipse-outline'} size={28} color={active === item.key ? colors.primary : colors.muted} />}
          <Text style={[styles.tabLabel, active === item.key && styles.tabLabelActive]}>{item.label}</Text>
          {active === item.key && <View style={styles.tabIndicator} />}
        </Pressable>
      ))}
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction && (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'blue' | 'outline' | 'danger' | 'soft';

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        styles[`button_${variant}`],
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={20} color={variant === 'outline' || variant === 'soft' ? colors.primary : colors.surface} />}
      <Text style={[styles.primaryButtonText, (variant === 'outline' || variant === 'soft') && styles.primaryButtonTextDark]}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone = 'green' }: { label: string; tone?: 'green' | 'blue' | 'amber' | 'red' | 'slate' }) {
  return <View style={[styles.pill, styles[`pill_${tone}`]]}><Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{label}</Text></View>;
}

export function AnimalPhoto({ animal, size = 72, rounded = true, style }: { animal?: Animal; size?: number; rounded?: boolean; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      accessibilityLabel={animal ? `${animal.breed} ${animal.animal_type} reference` : 'Bovine reference'}
      source={getAnimalImageSource(animal?.animal_type)}
      contentFit="cover"
      style={[{ width: size, height: size, borderRadius: rounded ? 12 : 0, backgroundColor: colors.primaryLight }, style]}
    />
  );
}

export function TextField({ label, style, ...props }: TextInputProps & { label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.fieldWrap, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} placeholderTextColor={colors.muted} style={styles.textField} />
    </View>
  );
}

export function OptionChip({ label, selected, onPress, tone = 'green' }: { label: string; selected: boolean; onPress: () => void; tone?: 'green' | 'blue' | 'red' }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.optionChip, selected && (tone === 'blue' ? styles.optionChipSelectedBlue : tone === 'red' ? styles.optionChipSelectedRed : styles.optionChipSelected)]}>
      <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Viewfinder({ label = 'Position muzzle inside the oval frame.' }: { label?: string }) {
  return (
    <View style={styles.viewfinderCard}>
      <View style={styles.viewfinderGrid}>
        <View style={styles.crosshairHorizontal} />
        <View style={styles.crosshairVertical} />
        <View style={styles.muzzleOval}>
          <Ionicons name="scan-outline" size={74} color="rgba(255,255,255,0.85)" />
          <Text style={styles.viewfinderHint}>MUZZLE</Text>
        </View>
        <View style={styles.cornerTopLeft} />
        <View style={styles.cornerTopRight} />
        <View style={styles.cornerBottomLeft} />
        <View style={styles.cornerBottomRight} />
      </View>
      <View style={styles.viewfinderFooter}>
        <View style={styles.goodDot} />
        <Text style={styles.viewfinderFooterText}>Good ✓</Text>
        <Text style={styles.viewfinderInstruction}>{label}</Text>
      </View>
    </View>
  );
}

export function PipelineList({ steps, activeStep }: { steps: string[]; activeStep: number }) {
  return (
    <View style={styles.pipelineList}>
      {steps.map((step, index) => {
        const complete = index < activeStep;
        const active = index === activeStep;
        return (
          <View key={step} style={styles.pipelineRow}>
            <View style={[styles.pipelineIcon, complete && styles.pipelineComplete, active && styles.pipelineActive]}>
              {complete ? <Ionicons name="checkmark" size={14} color={colors.surface} /> : active ? <ActivityIndicator size="small" color={colors.blue} /> : <Text style={styles.pipelineNumber}>{index + 1}</Text>}
            </View>
            <Text style={[styles.pipelineText, active && styles.pipelineTextActive]}>{step}{complete ? ' ✓' : active ? '...' : ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="file-tray-outline" size={30} color={colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 10, gap: 16 },
  stateScreen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  stateLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 15, textAlign: 'center' },
  errorIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18 },
  appHeader: { minHeight: 88, paddingHorizontal: 14, paddingTop: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  brandRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoMark: { width: 52, height: 52, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.primary },
  logoMarkCompact: { width: 44, height: 44, borderRadius: 22, borderWidth: 0 },
  logoMarkText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 13, position: 'absolute', bottom: 8 },
  brandCopy: { flex: 1, minWidth: 0, gap: 1 },
  brandName: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 23, letterSpacing: 0.2 },
  brandSubtitle: { color: '#526A84', fontFamily: Fonts.medium, fontSize: 9, lineHeight: 11, letterSpacing: -0.35, flexShrink: 1 },
  accountButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  accountInitials: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.3 },
  headerActions: { width: 148, flexShrink: 0, alignItems: 'flex-end', gap: 9, paddingTop: 8 },
  languageRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  languageItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  languageText: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 12 },
  languageActive: { color: colors.primary },
  languageDivider: { color: '#94A3B8', fontSize: 12 },
  networkChip: { width: 148, backgroundColor: colors.primaryLight, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, gap: 5 },
  networkChipOffline: { backgroundColor: colors.warningLight },
  onlineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
  offlineDot: { backgroundColor: colors.warning },
  networkText: { flex: 1, minWidth: 0, color: colors.primary, fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: -0.2 },
  networkTextOffline: { color: colors.warning },
  pageHeader: { minHeight: 62, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  pageHeaderCopy: { flex: 1, gap: 2 },
  pageHeaderEyebrow: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase' },
  pageHeaderTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 28, lineHeight: 32 },
  bottomNav: { minHeight: 72, paddingTop: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'space-around' },
  tabButton: { minWidth: 70, minHeight: 60, alignItems: 'center', justifyContent: 'flex-start', gap: 2 },
  tabLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  tabLabelActive: { color: colors.primary, fontFamily: Fonts.bold },
  tabIndicator: { height: 4, width: 76, borderRadius: 2, backgroundColor: colors.primary, marginTop: 4 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 22 },
  sectionAction: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  biometricScanIcon: { alignItems: 'center', justifyContent: 'center' },
  primaryButton: { minHeight: 50, borderRadius: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  button_primary: { backgroundColor: colors.primary },
  button_blue: { backgroundColor: colors.blue },
  button_outline: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary },
  button_danger: { backgroundColor: colors.danger },
  button_soft: { backgroundColor: colors.primaryLight },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  primaryButtonText: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 14, textAlign: 'center' },
  primaryButtonTextDark: { color: colors.primary },
  pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  pill_green: { backgroundColor: colors.primaryLight },
  pill_blue: { backgroundColor: colors.blueLight },
  pill_amber: { backgroundColor: colors.warningLight },
  pill_red: { backgroundColor: colors.dangerLight },
  pill_slate: { backgroundColor: colors.slateLight },
  pillText: { fontFamily: Fonts.semiBold, fontSize: 12 },
  pillText_green: { color: colors.primary },
  pillText_blue: { color: colors.blue },
  pillText_amber: { color: colors.warning },
  pillText_red: { color: colors.danger },
  pillText_slate: { color: colors.muted },
  fieldWrap: { gap: 7 },
  fieldLabel: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  textField: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 13, fontFamily: Fonts.regular, fontSize: 15 },
  optionChip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  optionChipSelected: { backgroundColor: colors.primaryLight, borderColor: colors.accent },
  optionChipSelectedBlue: { backgroundColor: colors.blueLight, borderColor: colors.blue },
  optionChipSelectedRed: { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  optionChipText: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 13 },
  optionChipTextSelected: { color: colors.primary, fontFamily: Fonts.bold },
  viewfinderCard: { overflow: 'hidden', borderRadius: 18, backgroundColor: '#0B2735', minHeight: 290 },
  viewfinderGrid: { flex: 1, minHeight: 230, position: 'relative', alignItems: 'center', justifyContent: 'center', backgroundColor: '#153D48' },
  crosshairHorizontal: { position: 'absolute', left: 22, right: 22, top: '50%', height: 1, backgroundColor: 'rgba(184, 233, 204, 0.35)' },
  crosshairVertical: { position: 'absolute', top: 20, bottom: 20, left: '50%', width: 1, backgroundColor: 'rgba(184, 233, 204, 0.35)' },
  muzzleOval: { width: 172, height: 150, borderRadius: 90, borderWidth: 2, borderColor: '#79D89C', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  viewfinderHint: { color: '#B8E9CC', fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 2 },
  cornerTopLeft: { position: 'absolute', top: 18, left: 18, width: 30, height: 30, borderTopWidth: 3, borderLeftWidth: 3, borderColor: '#9CE4AE' },
  cornerTopRight: { position: 'absolute', top: 18, right: 18, width: 30, height: 30, borderTopWidth: 3, borderRightWidth: 3, borderColor: '#9CE4AE' },
  cornerBottomLeft: { position: 'absolute', bottom: 18, left: 18, width: 30, height: 30, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: '#9CE4AE' },
  cornerBottomRight: { position: 'absolute', bottom: 18, right: 18, width: 30, height: 30, borderBottomWidth: 3, borderRightWidth: 3, borderColor: '#9CE4AE' },
  viewfinderFooter: { minHeight: 58, backgroundColor: '#0B2735', paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  goodDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#56D47D' },
  viewfinderFooterText: { color: '#A7F3C1', fontFamily: Fonts.bold, fontSize: 13 },
  viewfinderInstruction: { flex: 1, color: '#D8E8EE', fontFamily: Fonts.regular, fontSize: 12, textAlign: 'right' },
  pipelineList: { gap: 14 },
  pipelineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pipelineIcon: { width: 27, height: 27, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  pipelineComplete: { backgroundColor: colors.accent, borderColor: colors.accent },
  pipelineActive: { backgroundColor: colors.blueLight, borderColor: colors.blue },
  pipelineNumber: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 12 },
  pipelineText: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 14, flex: 1 },
  pipelineTextActive: { color: colors.blue, fontFamily: Fonts.bold },
  emptyState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 },
  emptyTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  emptyMessage: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, textAlign: 'center' },
});
