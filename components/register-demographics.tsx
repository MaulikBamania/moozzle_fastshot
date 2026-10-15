import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, OptionChip, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Text } from '@/components/translated-text';
import { Fonts } from '@/constants/Typography';
import { deviceUtcOffsetMinutes, formatCoordinate, formatLocalDateTime, formatUtcOffset } from '@/lib/demographics';
import type { GpsStatus } from '@/lib/use-gps';
import type { GpsFix } from '@/store/types';

/** Section label with a mandatory marker. */
export function FieldLabel({ label, required = true, hint }: { label: string; required?: boolean; hint?: string }) {
  return (
    <View style={styles.labelWrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {required ? <Text style={styles.required} accessibilityLabel="required">*</Text> : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <View style={styles.fieldError}>
      <Ionicons name="alert-circle" size={14} color={colors.danger} />
      <Text selectable style={styles.fieldErrorText}>{message}</Text>
    </View>
  );
}

/** A labelled single-choice row of chips; locked rows show why the value is fixed. */
export function ChoiceField<T extends string>({ label, options, value, onChange, error, lockedTo, lockedReason, hint, tone, required = true }: {
  label: string;
  /** Shows the red asterisk; defaults to true. */
  required?: boolean;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
  /** When set, only this option is allowed and the row is read-only. */
  lockedTo?: T | null;
  lockedReason?: string;
  hint?: string;
  tone?: 'green' | 'blue';
}) {
  const locked = lockedTo !== undefined && lockedTo !== null;
  return (
    <View style={styles.block}>
      <FieldLabel label={label} hint={hint} required={required} />
      <View style={styles.chipWrap}>
        {options.map((option) => (
          <OptionChip
            key={option.value}
            label={option.label}
            selected={(locked ? lockedTo : value) === option.value}
            onPress={() => onChange(option.value)}
            disabled={locked && option.value !== lockedTo}
            tone={tone}
          />
        ))}
      </View>
      {locked && lockedReason ? (
        <View style={styles.lockNote}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.muted} />
          <Text style={styles.lockNoteText}>{lockedReason}</Text>
        </View>
      ) : null}
      <FieldError message={error} />
    </View>
  );
}

export function ReadOnlyField({ label, value, caption, icon, error }: { label: string; value: string; caption?: string; icon: keyof typeof Ionicons.glyphMap; error?: string }) {
  return (
    <View style={styles.block}>
      <FieldLabel label={label} hint="Calculated automatically — not editable" />
      <View style={[styles.readOnly, error ? styles.readOnlyError : null]} accessibilityLabel={`${label}: ${value}`}>
        <View style={styles.readOnlyIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
        <View style={styles.flex}>
          <Text selectable style={styles.readOnlyValue}>{value}</Text>
          {caption ? <Text style={styles.readOnlyCaption}>{caption}</Text> : null}
        </View>
      </View>
      <FieldError message={error} />
    </View>
  );
}

export function SocietyFields({ name, code, member, onName, onCode, onMember, errors }: {
  name: string;
  code: string;
  member: string;
  onName: (value: string) => void;
  onCode: (value: string) => void;
  onMember: (value: string) => void;
  errors: { name?: string; code?: string; member?: string };
}) {
  return (
    <View style={styles.society}>
      <RequiredInput label="Society Name" value={name} onChangeText={onName} placeholder="e.g. Shree Dashela Dudh Utpadak Mandali" error={errors.name} maxLength={120} />
      <RequiredInput label="Society Code" value={code} onChangeText={onCode} placeholder="Code issued by the dairy union" error={errors.code} maxLength={40} autoCapitalize="characters" />
      <RequiredInput label="Member Code" value={member} onChangeText={onMember} placeholder="Your member number at the society" error={errors.member} maxLength={40} autoCapitalize="characters" />
    </View>
  );
}

function RequiredInput({ label, error, ...props }: { label: string; error?: string; value: string; onChangeText: (value: string) => void; placeholder: string; maxLength: number; autoCapitalize?: 'characters' | 'sentences' }) {
  return (
    <View style={styles.inputBlock}>
      <TextField label={`${label} *`} {...props} />
      <FieldError message={error} />
    </View>
  );
}

/** Live local clock; the exact instant is stamped when the registration is submitted. */
export const RegistrationTimeCard = memo(function RegistrationTimeCard() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.block}>
      <FieldLabel label="Registration Date and Time" hint="Captured automatically from this device when you submit; the server time is also recorded" />
      <View style={styles.readOnly}>
        <View style={styles.readOnlyIcon}><Ionicons name="time-outline" size={18} color={colors.primary} /></View>
        <View style={styles.flex}>
          <Text selectable style={styles.readOnlyValue}>{formatLocalDateTime(now)}</Text>
          <Text style={styles.readOnlyCaption}>Device local time · {formatUtcOffset(deviceUtcOffsetMinutes(now))}</Text>
        </View>
      </View>
    </View>
  );
});

const GPS_TITLES: Record<GpsStatus, string> = {
  idle: 'GPS not captured yet',
  locating: 'Getting GPS position…',
  ready: 'GPS location captured',
  denied: 'Location permission needed',
  blocked: 'Location permission blocked',
  services_off: 'Location services are off',
  error: 'GPS position not available',
};

export function GpsCard({ status, fix, error, onCapture, onOpenSettings, canOpenSettings, showRequired, optional = false }: {
  status: GpsStatus;
  fix: GpsFix | null;
  error: string;
  onCapture: () => void;
  onOpenSettings: () => void;
  canOpenSettings: boolean;
  /** Highlight the card after the user tried to continue without a fix. */
  showRequired: boolean;
  /** Registration no longer requires GPS; the card then invites, rather than demands, a capture. */
  optional?: boolean;
}) {
  const ready = status === 'ready' && fix !== null;
  const locating = status === 'locating';
  const problem = !ready && !locating && status !== 'idle';
  let icon: ReactNode = <Ionicons name="location-outline" size={20} color={colors.muted} />;
  if (ready) icon = <Ionicons name="checkmark-circle" size={20} color={colors.primary} />;
  else if (locating) icon = <ActivityIndicator size="small" color={colors.blue} />;
  else if (problem) icon = <Ionicons name="warning" size={20} color={colors.danger} />;

  return (
    <View style={styles.block}>
      <FieldLabel label="GPS Latitude and Longitude" required={!optional} hint={`${optional ? 'Optional' : 'Compulsory'} · taken from the phone's location services, never typed in`} />
      <View style={[styles.gpsCard, ready && styles.gpsReady, (problem || (showRequired && !ready && !locating)) && styles.gpsProblem]} accessibilityLiveRegion="polite">
        <View style={styles.gpsHeader}>
          {icon}
          <Text style={[styles.gpsTitle, ready && styles.gpsTitleReady, problem && styles.gpsTitleProblem]}>{GPS_TITLES[status]}</Text>
        </View>
        {ready && fix ? (
          <View style={styles.gpsGrid}>
            <GpsValue label="Latitude" value={formatCoordinate(fix.latitude, 'N', 'S')} />
            <GpsValue label="Longitude" value={formatCoordinate(fix.longitude, 'E', 'W')} />
            <GpsValue label="Accuracy" value={fix.accuracy !== null ? `± ${fix.accuracy < 10 ? fix.accuracy.toFixed(1) : Math.round(fix.accuracy)} m` : 'Not reported'} />
            <GpsValue label="Captured at" value={formatLocalDateTime(fix.capturedAt)} />
          </View>
        ) : null}
        {status === 'idle' ? <Text style={styles.gpsBody}>Stand next to the animal and tap Capture GPS. Allow location access when the phone asks{optional ? ' — or skip it, GPS is optional.' : ' — registration cannot continue without it.'}</Text> : null}
        {locating ? <Text style={styles.gpsBody}>Keep the phone still with a clear view of the sky. This can take up to 30 seconds.</Text> : null}
        {problem && error ? <Text selectable style={styles.gpsErrorText}>{error}</Text> : null}
        {status === 'services_off' ? <Text style={styles.gpsBody}>Android: swipe down from the top of the screen and turn on Location. iPhone: Settings → Privacy & Security → Location Services.</Text> : null}
        {showRequired && status === 'idle' ? <FieldError message="Capture the GPS location to continue." /> : null}
        <View style={styles.gpsActions}>
          <PrimaryButton
            label={locating ? 'Capturing…' : ready ? 'Recapture GPS' : status === 'idle' ? 'Capture GPS' : 'Retry / Capture GPS'}
            icon="locate-outline"
            variant={ready ? 'outline' : 'primary'}
            onPress={onCapture}
            disabled={locating}
            style={styles.flex}
          />
          {status === 'blocked' && canOpenSettings ? <PrimaryButton label="Open Settings" icon="settings-outline" variant="outline" onPress={onOpenSettings} style={styles.flex} /> : null}
        </View>
      </View>
    </View>
  );
}

function GpsValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.gpsValue}>
      <Text style={styles.gpsValueLabel}>{label}</Text>
      <Text selectable style={styles.gpsValueText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { gap: 8 },
  labelWrap: { gap: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 3 },
  label: { flexShrink: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  required: { color: colors.danger, fontFamily: Fonts.bold, fontSize: 15 },
  hint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 16 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fieldError: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  fieldErrorText: { flex: 1, color: colors.danger, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  lockNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  lockNoteText: { flex: 1, color: colors.muted, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  readOnly: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderCurve: 'continuous', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.background },
  readOnlyError: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  readOnlyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  readOnlyValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 17, letterSpacing: 0.4 },
  readOnlyCaption: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 1 },
  society: { gap: 12, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colors.primaryLight },
  inputBlock: { gap: 5 },
  gpsCard: { gap: 12, padding: 14, borderRadius: 14, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  gpsReady: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  gpsProblem: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  gpsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gpsTitle: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  gpsTitleReady: { color: colors.primary },
  gpsTitleProblem: { color: colors.danger },
  gpsBody: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19 },
  gpsErrorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19 },
  gpsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  gpsValue: { width: '50%', gap: 2, paddingRight: 8 },
  gpsValueLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 11 },
  gpsValueText: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13, fontVariant: ['tabular-nums'] },
  gpsActions: { flexDirection: 'row', gap: 10 },
});
