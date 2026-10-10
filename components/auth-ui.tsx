import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandWordmark, colors } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { useAppStore } from '@/store/useAppStore';
import type { Language } from '@/store/types';

const heroPhoto = require('../assets/design/photo-gir-cow-37fd7402.jpg');

export function authErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fallback;
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 18 }]}>
          <Image source={heroPhoto} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel="Gir cow in the field" />
          <View style={styles.heroShade} />
          <View style={styles.brandRow}>
            <View style={styles.brandLogo}>
              <BrandWordmark width={200} />
            </View>
            <LanguageSelector />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>One Muzzle. One Identity.{'\n'}One Digital Record.</Text>
            <View style={styles.heroPoints}>
              <HeroPoint icon="finger-print-outline" label="Muzzle enrolment" />
              <HeroPoint icon="cloud-done-outline" label="Cloud archive" />
              <HeroPoint icon="medkit-outline" label="AI & health log" />
            </View>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={styles.body}>{children}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LanguageSelector() {
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  return (
    <View style={styles.lang}>
      {(['EN', 'HI', 'GU'] as Language[]).map((item) => (
        <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Language ${item}`} accessibilityState={{ selected: language === item }} onPress={() => setLanguage(item)} style={[styles.langItem, language === item && styles.langItemActive]}>
          <Text style={[styles.langText, language === item && styles.langTextActive]}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function HeroPoint({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.heroPoint}>
      <Ionicons name={icon} size={14} color="#B8E9CC" />
      <Text style={styles.heroPointText}>{label}</Text>
    </View>
  );
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.error}>
      <Ionicons name="alert-circle" size={18} color={colors.danger} />
      <Text selectable style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  hero: { minHeight: 290, paddingHorizontal: 20, paddingBottom: 54, justifyContent: 'space-between', overflow: 'hidden', backgroundColor: colors.primary },
  heroShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4, 47, 34, 0.64)' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lang: { marginLeft: 'auto', flexDirection: 'row', borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.14)' },
  langItem: { minWidth: 40, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  langItemActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  langText: { color: '#D1FAE5', fontFamily: Fonts.semiBold, fontSize: 12 },
  langTextActive: { color: colors.surface, fontFamily: Fonts.bold },
  brandLogo: { flex: 1, minWidth: 0 },
  heroCopy: { gap: 14, marginTop: 28 },
  heroTitle: { color: colors.surface, fontFamily: Fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.4 },
  heroPoints: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroPoint: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)' },
  heroPointText: { color: colors.surface, fontFamily: Fonts.semiBold, fontSize: 11 },
  card: { marginTop: -30, marginHorizontal: 14, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 20, gap: 4, shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 24 },
  subtitle: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  body: { gap: 14, marginTop: 14 },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, borderRadius: 10, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
});
