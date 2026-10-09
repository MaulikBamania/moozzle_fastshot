import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, OptionChip, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import type { ServiceKind } from '@/lib/rbac';

export interface FieldSpec {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  keyboard?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
}

export interface FormSpec {
  title: string;
  fields: FieldSpec[];
}

/** Clinical/service record templates. Title = record type stored on the signed record. */
export const SERVICE_FORMS: Record<ServiceKind, FormSpec[]> = {
  health: [
    { title: 'Treatment', fields: [{ key: 'diagnosis', label: 'Diagnosis', required: true, placeholder: 'e.g. Subclinical mastitis' }, { key: 'prescription', label: 'Treatment / prescription', required: true, placeholder: 'Drug, dose, duration' }, { key: 'follow_up', label: 'Follow-up', placeholder: 'e.g. Recheck in 7 days' }, { key: 'notes', label: 'Clinical notes', multiline: true }] },
    { title: 'Vaccination', fields: [{ key: 'vaccine', label: 'Vaccine', required: true, placeholder: 'e.g. FMD, HS, BQ, LSD' }, { key: 'next_due', label: 'Next due (YYYY-MM-DD)', placeholder: '2027-04-01' }, { key: 'notes', label: 'Notes', multiline: true }] },
    { title: 'Pregnancy Diagnosis', fields: [{ key: 'result', label: 'Result', required: true, placeholder: 'Pregnant / Not pregnant' }, { key: 'expected_calving', label: 'Expected calving (YYYY-MM-DD)' }, { key: 'notes', label: 'Notes', multiline: true }] },
    { title: 'Calving', fields: [{ key: 'calf', label: 'Calf (sex, condition)', required: true, placeholder: 'Female calf, healthy' }, { key: 'notes', label: 'Notes', multiline: true }] },
    { title: 'Deworming', fields: [{ key: 'drug', label: 'Drug and dose', required: true }, { key: 'next_due', label: 'Next due (YYYY-MM-DD)' }, { key: 'notes', label: 'Notes', multiline: true }] },
  ],
  ai: [
    { title: 'Artificial Insemination', fields: [{ key: 'time', label: 'AI time (HH:MM)', required: true, placeholder: '06:30' }, { key: 'bull', label: 'Bull ID / breed', required: true, placeholder: 'e.g. Gir HB-1142' }, { key: 'semen_batch', label: 'Semen batch', required: true, placeholder: 'e.g. SSC-GIR-24-0871' }, { key: 'semen_station', label: 'Semen station', placeholder: 'e.g. Sabarmati Semen Station' }, { key: 'attempt', label: 'Attempt number', keyboard: 'numeric', placeholder: '1' }, { key: 'notes', label: 'Notes', multiline: true }] },
    { title: 'Follow-up Visit', fields: [{ key: 'finding', label: 'Finding', required: true, placeholder: 'e.g. Repeat heat observed' }, { key: 'notes', label: 'Notes', multiline: true }] },
  ],
  insurance: [],
  traceability: [
    { title: 'Movement', fields: [{ key: 'from', label: 'From', required: true }, { key: 'to', label: 'To', required: true }, { key: 'notes', label: 'Notes', multiline: true }] },
    { title: 'Inspection', fields: [{ key: 'finding', label: 'Inspection finding', required: true, placeholder: 'e.g. Identity verified, healthy' }, { key: 'notes', label: 'Notes', multiline: true }] },
    { title: 'Traceability Exception', fields: [{ key: 'issue', label: 'Issue', required: true, placeholder: 'e.g. Muzzle does not match registered identity' }, { key: 'notes', label: 'Notes', multiline: true }] },
  ],
  operations: [
    { title: 'Milk Production', fields: [{ key: 'litres', label: 'Total litres today', required: true, keyboard: 'numeric' }, { key: 'notes', label: 'Morning / evening split', multiline: true }] },
    { title: 'Feed and Nutrition', fields: [{ key: 'notes', label: 'Feed given', required: true, multiline: true, placeholder: 'Green fodder, concentrate, mineral mix' }] },
  ],
};

const NO_FIELDS: FieldSpec[] = [];

export interface FormSubmit {
  title: string;
  values: Record<string, string>;
}

/** Bottom-sheet form with validation. Mount it only while open so each opening starts fresh. Backdrop is a sibling of the dialog panel. */
export function FormSheet({
  visible,
  heading,
  specs,
  initialTitle,
  extraFields = NO_FIELDS,
  submitLabel,
  confirmText,
  danger = false,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  heading: string;
  specs: FormSpec[];
  initialTitle?: string;
  extraFields?: FieldSpec[];
  submitLabel: string;
  confirmText?: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (data: FormSubmit) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(initialTitle ?? specs[0]?.title ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const spec = specs.find((item) => item.title === title) ?? specs[0];
  const fields = useMemo(() => [...(spec?.fields ?? []), ...extraFields], [extraFields, spec]);
  const specTitle = spec?.title ?? title;

  const submit = useCallback(async () => {
    const missing = fields.find((field) => field.required && !values[field.key]?.trim());
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const trimmed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
      await onSubmit({ title: specTitle, values: trimmed });
    } catch (caught) {
      console.error('Form submission failed', caught);
      setError(typeof caught === 'object' && caught !== null && 'message' in caught && typeof caught.message === 'string' ? caught.message : 'This could not be saved. Please retry.');
    } finally {
      setSaving(false);
    }
  }, [fields, onSubmit, specTitle, values]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityLabel="Close form" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <Text style={styles.heading}>{heading}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.body}>
            {specs.length > 1 ? (
              <View style={styles.chips}>{specs.map((item) => <OptionChip key={item.title} label={item.title} selected={item.title === title} onPress={() => setTitle(item.title)} />)}</View>
            ) : null}
            {fields.map((field) => (
              <TextField
                key={`${title}-${field.key}`}
                label={`${field.label}${field.required ? ' *' : ''}`}
                value={values[field.key] ?? ''}
                onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))}
                placeholder={field.placeholder}
                multiline={field.multiline}
                keyboardType={field.keyboard ?? 'default'}
              />
            ))}
            {confirmText ? <View style={[styles.confirm, danger && styles.confirmDanger]}><Ionicons name="alert-circle-outline" size={18} color={danger ? colors.danger : colors.warning} /><Text style={styles.confirmText}>{confirmText}</Text></View> : null}
            {error ? <Text selectable accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <PrimaryButton label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
              <PrimaryButton label={saving ? 'Saving…' : submitLabel} variant={danger ? 'danger' : 'primary'} onPress={() => void submit()} disabled={saving} style={styles.flex} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  panel: { width: '100%', maxWidth: 620, maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 6 },
  heading: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 19 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slateLight },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: 18, paddingBottom: 8, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirm: { flexDirection: 'row', gap: 8, backgroundColor: colors.warningLight, borderRadius: 12, padding: 12 },
  confirmDanger: { backgroundColor: colors.dangerLight },
  confirmText: { flex: 1, color: colors.text, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
