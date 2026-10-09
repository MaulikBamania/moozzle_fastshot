import { useAuth } from '@fastshot/auth';
import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthShell, authErrorMessage, Divider, InlineError } from '@/components/auth-ui';
import { colors, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { DEMO_ACCOUNTS, DEMO_MODE, DEMO_PASSWORD } from '@/lib/demo';
import { ROLE_EXPERIENCE } from '@/lib/rbac';
import { supabase } from '@/lib/supabase';
import { Fonts } from '@/constants/Typography';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ error?: string }>();
  const { signInWithEmail, signInWithGoogle, signInWithApple, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(params.error ?? null);

  const run = useCallback(async (action: () => Promise<unknown>, fallback: string, identifier = '') => {
    setErrorMessage(null);
    try {
      await action();
      // AuthProvider routes to the app once the session exists.
    } catch (error) {
      console.error('Sign-in failed', error);
      setErrorMessage(authErrorMessage(error, fallback));
      if (identifier) {
        // Failed authentication is audited with a masked identifier only.
        const { error: auditError } = await supabase.rpc('log_auth_failure', { p_identifier: identifier });
        if (auditError) console.error('Failed sign-in was not audited', auditError);
      }
    }
  }, []);
  const signInDemo = useCallback((demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    void run(() => signInWithEmail(demoEmail, DEMO_PASSWORD), 'The demo account could not sign in.', demoEmail);
  }, [run, signInWithEmail]);

  const handleEmail = useCallback(() => {
    if (!email.trim() || !password) {
      setErrorMessage('Enter your email and password.');
      return;
    }
    if (!email.includes('@')) {
      setErrorMessage('Mobile-number sign-in with OTP is not enabled for this deployment yet. Use your registered email.');
      return;
    }
    void run(() => signInWithEmail(email.trim(), password), 'Unable to sign in. Please try again.', email.trim());
  }, [email, password, run, signInWithEmail]);
  const handleGoogle = useCallback(() => void run(signInWithGoogle, 'Google sign-in did not complete.'), [run, signInWithGoogle]);
  const handleApple = useCallback(() => void run(signInWithApple, 'Apple sign-in did not complete.'), [run, signInWithApple]);

  return (
    <AuthShell title="Sign in to MOOZZLE" subtitle="Your workspace, dashboard and permissions are loaded from your assigned role.">
      <TextField label="Mobile number or email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" textContentType="emailAddress" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Your password" textContentType="password" onSubmitEditing={handleEmail} />
      <View style={styles.forgotRow}>
        <Link href="/(auth)/forgot-password" style={styles.link}>Forgot password?</Link>
      </View>
      <InlineError message={errorMessage} />
      <PrimaryButton label={isLoading ? 'Signing in…' : 'Sign In'} icon="log-in-outline" onPress={handleEmail} disabled={isLoading} />
      <Divider label="or continue with" />
      <Pressable accessibilityRole="button" onPress={handleGoogle} disabled={isLoading} style={({ pressed }) => [styles.social, pressed && styles.pressed, isLoading && styles.disabled]}>
        <Ionicons name="logo-google" size={19} color={colors.text} />
        <Text style={styles.socialText}>Continue with Google</Text>
      </Pressable>
      {Platform.OS === 'ios' && (
        <Pressable accessibilityRole="button" onPress={handleApple} disabled={isLoading} style={({ pressed }) => [styles.social, styles.apple, pressed && styles.pressed, isLoading && styles.disabled]}>
          <Ionicons name="logo-apple" size={20} color={colors.surface} />
          <Text style={[styles.socialText, styles.appleText]}>Continue with Apple</Text>
        </Pressable>
      )}
      <View style={styles.footer}>
        <Text style={styles.footerText}>New to MOOZZLE?</Text>
        <Link href="/(auth)/signup" style={styles.link}>Create an account</Link>
      </View>
      {DEMO_MODE ? (
        <View style={styles.demo}>
          <View style={styles.demoHead}>
            <Text style={styles.demoTitle}>Synthetic demo accounts</Text>
            <View style={styles.demoPill}><Text style={styles.demoPillText}>DEMO ONLY</Text></View>
          </View>
          <Text style={styles.footerText}>Each opens its own role dashboard with synthetic data. Shown only in demo builds.</Text>
          <View style={styles.demoGrid}>
            {DEMO_ACCOUNTS.map((account) => (
              <Pressable key={account.email} accessibilityRole="button" accessibilityLabel={`Sign in as demo ${account.role}`} onPress={() => signInDemo(account.email)} disabled={isLoading} style={({ pressed }) => [styles.demoItem, pressed && styles.pressed, isLoading && styles.disabled]}>
                <Ionicons name={ROLE_EXPERIENCE[account.role].icon} size={16} color={ROLE_EXPERIENCE[account.role].tone} />
                <View style={styles.demoCopy}>
                  <Text numberOfLines={1} style={styles.demoRole}>{account.email === 'demo.multirole@moozzle.com' ? 'Multi-role' : ROLE_EXPERIENCE[account.role].short}</Text>
                  <Text numberOfLines={1} style={styles.demoEmail}>{account.email.replace('@moozzle.com', '')}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  forgotRow: { alignItems: 'flex-end', marginTop: -4 },
  link: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 13, paddingVertical: 6 },
  social: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  apple: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  socialText: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  appleText: { color: colors.surface },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  footerText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  demo: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  demoHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  demoTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  demoPill: { backgroundColor: colors.warningLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  demoPillText: { color: colors.warning, fontFamily: Fonts.bold, fontSize: 10 },
  demoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoItem: { flexBasis: '47%', flexGrow: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, backgroundColor: colors.background },
  demoCopy: { flex: 1, minWidth: 0 },
  demoRole: { color: colors.text, fontFamily: Fonts.bold, fontSize: 12 },
  demoEmail: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 10 },
});
