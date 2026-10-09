import { useAuth } from '@fastshot/auth';
import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthShell, authErrorMessage, Divider, InlineError } from '@/components/auth-ui';
import { colors, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ error?: string }>();
  const { signInWithEmail, signInWithGoogle, signInWithApple, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(params.error ?? null);

  const run = useCallback(async (action: () => Promise<unknown>, fallback: string) => {
    setErrorMessage(null);
    try {
      await action();
      // AuthProvider routes to the app once the session exists.
    } catch (error) {
      console.error('Sign-in failed', error);
      setErrorMessage(authErrorMessage(error, fallback));
    }
  }, []);

  const handleEmail = useCallback(() => {
    if (!email.trim() || !password) {
      setErrorMessage('Enter your email and password.');
      return;
    }
    void run(() => signInWithEmail(email.trim(), password), 'Unable to sign in. Please try again.');
  }, [email, password, run, signInWithEmail]);
  const handleGoogle = useCallback(() => void run(signInWithGoogle, 'Google sign-in did not complete.'), [run, signInWithGoogle]);
  const handleApple = useCallback(() => void run(signInWithApple, 'Apple sign-in did not complete.'), [run, signInWithApple]);

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage the bovines you have enrolled and their service history.">
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" textContentType="emailAddress" />
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
});
