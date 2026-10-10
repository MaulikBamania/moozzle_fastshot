import { useAuth } from '@fastshot/auth';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { AuthShell, authErrorMessage, InlineError } from '@/components/auth-ui';
import { colors, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';

export default function SignUpScreen() {
  const { signUpWithEmail, isLoading } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [village, setVillage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const handleSignUp = useCallback(async () => {
    setErrorMessage(null);
    if (!fullName.trim()) return setErrorMessage('Enter your full name.');
    if (!email.trim()) return setErrorMessage('Enter your email address.');
    if (password.length < 6) return setErrorMessage('Use a password with at least 6 characters.');
    try {
      const result = await signUpWithEmail(email.trim(), password, {
        data: { full_name: fullName.trim(), phone: phone.trim(), village: village.trim() },
      });
      if (result.emailConfirmationRequired) setConfirmationEmail(result.email || email.trim());
      // With a session, AuthProvider routes to the app.
    } catch (error) {
      console.error('Sign-up failed', error);
      setErrorMessage(authErrorMessage(error, 'Unable to create your account. Please try again.'));
    }
  }, [email, fullName, password, phone, signUpWithEmail, village]);

  if (confirmationEmail) {
    return (
      <AuthShell title="Check your email" subtitle="One more step before you can start enrolling bovines.">
        <View style={styles.confirmBox}>
          <Ionicons name="mail-unread-outline" size={30} color={colors.primary} />
          <Text style={styles.confirmText}>
            We sent a verification link to <Text selectable style={styles.confirmEmail}>{confirmationEmail}</Text>. Open it, then sign in with your password.
          </Text>
        </View>
        <PrimaryButton label="Go to Sign In" icon="log-in-outline" onPress={() => router.replace('/(auth)/login')} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Register your cattle and buffalo and see their health and breeding records.">
      <TextField label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" placeholder="e.g. Ramesh Patel" />
      <View style={styles.roleBlock}>
        <Text style={styles.label}>Account type: Farmer / Animal Owner</Text>
        <Text style={styles.roleNote}>Self-registration creates a farmer account. Staff roles (veterinarian, technician, officer, administrator) are assigned by your organisation administrator after sign-up.</Text>
      </View>
      <View style={styles.row}>
        <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98765 43210" style={styles.half} />
        <TextField label="Village" value={village} onChangeText={setVillage} placeholder="Sanand" style={styles.half} />
      </View>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 6 characters" />
      <InlineError message={errorMessage} />
      <PrimaryButton label={isLoading ? 'Creating account…' : 'Create Account'} icon="person-add-outline" onPress={() => void handleSignUp()} disabled={isLoading} />
      <View style={styles.footer}>
        <Text style={styles.footerText}>Already registered?</Text>
        <Link href="/(auth)/login" style={styles.link}>Sign in</Link>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  roleBlock: { gap: 8 },
  label: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  roleNote: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  link: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 13, paddingVertical: 6 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  footerText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13 },
  confirmBox: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 12, backgroundColor: colors.primaryLight },
  confirmText: { flex: 1, color: colors.text, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 21 },
  confirmEmail: { fontFamily: Fonts.bold, color: colors.primary },
});
