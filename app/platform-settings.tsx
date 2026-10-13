import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/translated-text';
import { StackScreen, go } from '@/components/app-chrome';
import { FormSheet } from '@/components/record-forms';
import { Card, colors, DataGate, Pill, PrimaryButton } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { supabase } from '@/lib/supabase';
import { loadBovineData, useBovineStore, useSession } from '@/store/useBovineStore';
import type { SettingRow } from '@/store/types';

/** Governed by the versioned configuration workflow (propose, approve, promote); never edited here. */
const GOVERNED_KEYS = new Set(['biometric_threshold', 'model_version', 'match_threshold', 'verify_threshold', 'review_threshold']);

const LABELS: Record<string, string> = {
  biometric_threshold: 'Legacy match threshold (unused)',
  model_version: 'Biometric model version',
  match_threshold: '1:N identification accept threshold',
  verify_threshold: '1:1 verification accept threshold',
  review_threshold: '1:N review threshold',
  data_retention_days: 'Record retention after retirement (days)',
  raw_image_retention_days: 'Raw muzzle image retention (days)',
  require_registration_approval: 'Registrations need approval',
  api_default_rate_limit: 'Default API rate limit (per minute)',
};

function parseValue(setting: SettingRow, raw: string): string | number | boolean {
  if (typeof setting.value === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('Enter a number.');
    return value;
  }
  if (typeof setting.value === 'boolean') {
    if (!/^(true|false)$/i.test(raw)) throw new Error('Enter true or false.');
    return raw.toLowerCase() === 'true';
  }
  return raw;
}

export default function PlatformSettingsScreen() {
  return (
    <DataGate>
      <StackScreen title="System Settings" eyebrow="Biometric engine & retention" destination="settings">
        <SettingsContent />
      </StackScreen>
    </DataGate>
  );
}

function SettingsContent() {
  const session = useSession();
  const settings = useBovineStore((state) => state.settings);
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [notice, setNotice] = useState('');
  const isSuper = session.role === 'Super Administrator';
  const canEdit = (setting: SettingRow) => !GOVERNED_KEYS.has(setting.key) && ((isSuper && session.privileged) || (session.role === 'API Administrator' && setting.key === 'api_default_rate_limit'));

  return (
    <>
      {isSuper && !session.privileged ? (
        <Card style={styles.card}>
          <Text style={styles.body}>High-risk settings (thresholds, model version, retention) need an active privileged session and a reason.</Text>
          <PrimaryButton label="Start Privileged Access" icon="lock-open-outline" onPress={() => go('security')} />
        </Card>
      ) : null}
      {session.role === 'API Administrator' ? <Text style={styles.body}>Your access is limited to integration settings. Biometric thresholds can only be changed by an authorised Super Administrator.</Text> : null}
      {notice ? <Text selectable style={styles.ok}>{notice}</Text> : null}
      {settings.map((setting) => (
        <Card key={setting.key} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.title}>{LABELS[setting.key] ?? setting.key}</Text>
            {setting.risk === 'high' ? <Pill label="High risk" tone="red" /> : null}
          </View>
          <Text selectable style={styles.value}>{String(setting.value)}</Text>
          <Text style={styles.body}>{setting.description}</Text>
          <Text style={styles.meta}>Updated {new Date(setting.updated_at).toLocaleString()}</Text>
          {canEdit(setting) ? <PrimaryButton label="Change" variant="outline" onPress={() => setEditing(setting)} /> : null}
          {GOVERNED_KEYS.has(setting.key) ? (
            <>
              <Text style={styles.body}>Mirrors the production biometric configuration. Changes need a tested proposal, independent approval and promotion.</Text>
              <PrimaryButton label="Open Threshold Governance" icon="options-outline" variant="soft" onPress={() => go('performance')} />
            </>
          ) : null}
        </Card>
      ))}
      {editing ? (
        <FormSheet
          visible
          heading={LABELS[editing.key] ?? editing.key}
          specs={[{ title: 'Setting', fields: [{ key: 'value', label: `New value (current ${String(editing.value)})`, required: true }, { key: 'reason', label: 'Reason / approval reference', required: true, placeholder: 'At least 10 characters' }] }]}
          submitLabel="Apply Change"
          danger={editing.risk === 'high'}
          confirmText="This change is audited."
          onClose={() => setEditing(null)}
          onSubmit={async ({ values }) => {
            const value = parseValue(editing, values.value ?? '');
            const { error } = await supabase.rpc('update_setting', { p_key: editing.key, p_value: value, p_reason: values.reason ?? '' });
            if (error) throw error;
            setEditing(null);
            setNotice(`${LABELS[editing.key] ?? editing.key} updated and audited.`);
            await loadBovineData();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  value: { color: colors.primaryDark, fontFamily: Fonts.bold, fontSize: 22, fontVariant: ['tabular-nums'] },
  body: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { color: '#94A3B8', fontFamily: Fonts.regular, fontSize: 11 },
  ok: { color: colors.primaryDark, fontFamily: Fonts.semiBold, fontSize: 13 },
});
