import { useAuth } from '@fastshot/auth';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AuthShell, authErrorMessage, InlineError } from '@/components/auth-ui';
import { colors, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';

export default function ForgotPasswordScreen() {
  const { resetPassword, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleReset = useCallback(async () => {
    setErrorMessage(null);
    if (!email.trim()) return setErrorMessage('Enter the email you signed up with.');
    try {
      await resetPassword(email.trim());
      setSentTo(email.trim());
    } catch (error) {
      console.error('Password reset failed', error);
      setErrorMessage(authErrorMessage(error, 'Unable to send reset instructions. Please try again.'));
    }
  }, [email, resetPassword]);

  return (
    <AuthShell title="Reset password" subtitle="We will email you a link to choose a new password.">
      {sentTo ? (
        <View style={styles.sent}>
          <Ionicons name="mail-outline" size={26} color={colors.primary} />
          <Text style={styles.sentText}>Reset instructions were sent to <Text selectable style={styles.bold}>{sentTo}</Text>.</Text>
        </View>
      ) : (
        <>
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
          <InlineError message={errorMessage} />
          <PrimaryButton label={isLoading ? 'Sending…' : 'Send Reset Link'} icon="paper-plane-outline" onPress={() => void handleReset()} disabled={isLoading} />
        </>
      )}
      <Link href="/(auth)/login" style={styles.link}>Back to Sign In</Link>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  sent: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 14, borderRadius: 12, backgroundColor: colors.primaryLight },
  sentText: { flex: 1, color: colors.text, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
  bold: { fontFamily: Fonts.bold, color: colors.primary },
  link: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 13, textAlign: 'center', paddingVertical: 8 },
});
