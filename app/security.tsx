import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/translated-text';
import { StackScreen, go } from '@/components/app-chrome';
import { Card, colors, DataGate, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { endPrivilegedAccess, messageOf, startPrivilegedAccess, useSession } from '@/store/useBovineStore';

export default function SecurityScreen() {
  return (
    <DataGate>
      <StackScreen title="Security & Privileged Access" eyebrow="Super Administrator" destination="security">
        <SecurityContent />
      </StackScreen>
    </DataGate>
  );
}

function SecurityContent() {
  const session = useSession();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const start = useCallback(async () => {
    if (reason.trim().length < 10) {
      setError('Give a justification of at least 10 characters (e.g. ticket number and purpose).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await startPrivilegedAccess(reason.trim());
      setReason('');
      setNotice('Privileged access granted for 30 minutes. Every record you open is audited.');
    } catch (caught) {
      console.error('Privileged access failed', caught);
      setError(messageOf(caught, 'Privileged access could not be started.'));
    } finally {
      setBusy(false);
    }
  }, [reason]);

  const end = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await endPrivilegedAccess();
      setNotice('Privileged access ended.');
    } catch (caught) {
      console.error('Ending privileged access failed', caught);
      setError(messageOf(caught, 'Privileged access could not be ended.'));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <Card style={styles.card}>
        <Text style={styles.title}>{session.privileged ? 'Privileged session active' : 'Identifiable data is locked'}</Text>
        <Text style={styles.body}>Platform administration does not grant access to identifiable animal, owner or biometric records. Access must be explicitly justified, is time-limited to 30 minutes, ends when you switch role, and is recorded in the audit trail.</Text>
        {session.privileged ? (
          <>
            <Text style={styles.until}>Active until {new Date(session.privilegedUntil ?? '').toLocaleTimeString()}</Text>
            <PrimaryButton label="End Privileged Access" icon="lock-closed-outline" variant="danger" onPress={() => void end()} disabled={busy} />
          </>
        ) : (
          <>
            <TextField label="Justification (required)" value={reason} onChangeText={setReason} placeholder="e.g. SUP-2291 duplicate identity investigation" multiline />
            <PrimaryButton label={busy ? 'Requesting…' : 'Start Audited Privileged Access'} icon="lock-open-outline" onPress={() => void start()} disabled={busy} />
          </>
        )}
        {notice ? <Text selectable style={styles.ok}>{notice}</Text> : null}
        {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      </Card>
      <Card style={styles.card}>
        <Text style={styles.title}>Security review</Text>
        <Text style={styles.body}>Review denied access attempts, failed sign-ins and administrative changes.</Text>
        <PrimaryButton label="Open Audit Logs" icon="reader-outline" variant="outline" onPress={() => go('audit')} />
        <PrimaryButton label="Roles & Permissions" icon="key-outline" variant="outline" onPress={() => go('permissions')} />
        <PrimaryButton label="Biometric & Retention Settings" icon="settings-outline" variant="outline" onPress={() => go('settings')} />
      </Card>
      <Card style={styles.card}>
        <Text style={styles.title}>Data protection</Text>
        <Text style={styles.body}>Owner personal data is stored separately from animal identity; biometric templates are never shown on ordinary screens and never written to logs; research access uses de-identified data. These controls support DPDP Act 2023 obligations but are not a certification of legal compliance — a legal and technical assessment is still required.</Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  title: { color: colors.text, fontFamily: Fonts.bold, fontSize: 16 },
  body: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19 },
  until: { color: colors.danger, fontFamily: Fonts.bold, fontSize: 14 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
});
