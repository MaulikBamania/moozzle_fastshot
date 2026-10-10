import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { logAudit, useSession } from '@/store/useBovineStore';

/** Deny-by-default fallback. It never shows any part of the restricted data. */
export default function PermissionDeniedScreen() {
  const params = useLocalSearchParams<{ resource?: string; target?: string }>();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const logged = useRef(false);

  useEffect(() => {
    if (logged.current || !session.userId) return;
    logged.current = true;
    const resource = (params.resource ?? 'restricted screen').slice(0, 80);
    const target = /^\d{12}$/.test(params.target ?? '') ? params.target ?? '' : '';
    void logAudit('access.denied', target, `Blocked: ${resource}`, 'denied');
  }, [params.resource, params.target, session.userId]);

  return (
    <View style={[styles.page, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.icon}><Ionicons name="lock-closed" size={34} color={colors.danger} /></View>
      <Text style={styles.title}>Permission Denied</Text>
      <Text selectable style={styles.message}>You do not have permission to access this information. Contact your organisation administrator if you believe this is incorrect.</Text>
      {session.role ? <Text style={styles.meta}>Active role: {session.role}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton label="Go Back" icon="arrow-back" variant="outline" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} />
        <PrimaryButton label="Open Dashboard" icon="home-outline" onPress={() => router.replace('/(tabs)')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, alignItems: 'center', paddingHorizontal: 24, gap: 14 },
  icon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 26, textAlign: 'center' },
  message: { color: colors.text, fontFamily: Fonts.medium, fontSize: 16, lineHeight: 24, textAlign: 'center', maxWidth: 440 },
  meta: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  actions: { width: '100%', maxWidth: 360, gap: 10, marginTop: 10 },
});
