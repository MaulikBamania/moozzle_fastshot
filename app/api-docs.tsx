// Demo payload keys intentionally mirror the documented REST contract.
// biome-ignore-all lint/style/useNamingConvention: API response fields use the documented snake_case contract.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AppScreen,
  Card,
  colors,
  OptionChip,
  PageHeader,
  Pill,
  PrimaryButton,
  StorageGate,
  TextField,
} from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';

interface ApiEndpoint {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  title: string;
  description: string;
  schema: string;
}

type RequestState = 'idle' | 'sending' | 'sent' | 'error';

const ENDPOINTS: ApiEndpoint[] = [
  {
    id: 'enrol', method: 'POST', path: '/api/v1/animals/enrol', title: 'Enrol animal', description: 'Create a biometric identity from approved muzzle images.',
    schema: '{\n  "animal_type": "cattle",\n  "breed": "Gir",\n  "images": ["muzzle-image-01", "muzzle-image-02"]\n}',
  },
  {
    id: 'identify', method: 'POST', path: '/api/v1/animals/identify', title: 'Identify animal', description: 'Run a 1:N search against stored biometric templates.',
    schema: '{\n  "muzzle_image": "muzzle-image-query",\n  "threshold": 0.80\n}',
  },
  {
    id: 'verify', method: 'POST', path: '/api/v1/animals/verify', title: 'Verify animal', description: 'Run a 1:1 comparison against a supplied MOOZZLE ID.',
    schema: '{\n  "mooZZLE_id": "482731905614",\n  "muzzle_image": "muzzle-image-query"\n}',
  },
  {
    id: 'get-animal', method: 'GET', path: '/api/v1/animals/{mooZZLE_id}', title: 'Get animal', description: 'Retrieve an animal record and its biometric status.',
    schema: 'Path parameter:\n  mooZZLE_id: string (12 digits)',
  },
  {
    id: 'retire', method: 'POST', path: '/api/v1/animals/{mooZZLE_id}/retire', title: 'Retire animal', description: 'Mark a record as retired with an auditable reason.',
    schema: '{\n  "reason": "Transferred",\n  "notes": "Farm movement record"\n}',
  },
  {
    id: 'ai', method: 'POST', path: '/api/v1/animals/{mooZZLE_id}/ai', title: 'Add AI entry', description: 'Attach an artificial insemination service event.',
    schema: '{\n  "date": "2026-10-08",\n  "performed_by": "Demo technician",\n  "details": "Routine entry"\n}',
  },
  {
    id: 'health', method: 'POST', path: '/api/v1/animals/{mooZZLE_id}/health', title: 'Add health entry', description: 'Attach a vaccination, treatment, or health event.',
    schema: '{\n  "record_type": "Vaccination",\n  "date": "2026-10-08",\n  "details": "Routine vaccination"\n}',
  },
  {
    id: 'sync', method: 'POST', path: '/api/v1/sync', title: 'Sync queue', description: 'Upload locally queued records and image bundles.',
    schema: '{\n  "device_id": "demo-field-device-01",\n  "queue": {\n    "records": 12,\n    "images": 8\n  }\n}',
  },
];

const DEMO_DISCLAIMER = 'DEMO ONLY - Prototype/demo API response. Do not present demo match score as scientifically validated accuracy.';

export default function ApiDocsScreen() {
  return (
    <StorageGate>
      <ApiDocsContent />
    </StorageGate>
  );
}

function ApiDocsContent() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [animalId, setAnimalId] = useState('482731905614');
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [requestError, setRequestError] = useState('');
  const endpoint = ENDPOINTS[selectedIndex];
  const displayedPath = useMemo(() => endpoint.path.replace('{mooZZLE_id}', animalId || '{mooZZLE_id}'), [animalId, endpoint.path]);
  const requestPreview = useMemo(() => endpoint.schema, [endpoint.schema]);
  const responseText = useMemo(() => response ? JSON.stringify(response, null, 2) : '', [response]);

  const handleEndpointChange = useCallback((index: number) => {
    setSelectedIndex(index);
    setRequestState('idle');
    setResponse(null);
    setRequestError('');
  }, []);

  const handleAnimalIdChange = useCallback((value: string) => {
    setAnimalId(value.replace(/[^0-9]/g, '').slice(0, 12));
  }, []);

  const handleSend = useCallback(async () => {
    try {
      setRequestError('');
      setRequestState('sending');
      await wait(650);
      setResponse(createDemoResponse(endpoint, displayedPath));
      setRequestState('sent');
    } catch (caughtError) {
      console.error('Could not execute demo API request', caughtError);
      setRequestError('The demo request could not be completed. Try the request again.');
      setRequestState('error');
    }
  }, [displayedPath, endpoint]);

  const handleBack = useCallback(() => router.back(), []);
  const needsAnimalId = endpoint.path.includes('{mooZZLE_id}');

  return (
    <AppScreen scroll>
      <PageHeader eyebrow="Architecture" title="REST API Console" onBack={handleBack} />
      <View style={styles.content}>
        <Card style={styles.introCard}>
          <View style={styles.introIcon}><Ionicons name="code-slash-outline" size={25} color={colors.blue} /></View>
          <View style={styles.introCopy}>
            <Text style={styles.eyebrow}>Interactive tester</Text>
            <Text style={styles.introTitle}>Core MOOZZLE endpoints</Text>
            <Text style={styles.introText}>Inspect a request contract, substitute a path parameter, and run a local prototype response without making a network request.</Text>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Choose endpoint</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.endpointScroll} contentContainerStyle={styles.endpointContent}>
          {ENDPOINTS.map((item, index) => <OptionChip key={item.id} label={item.title} selected={index === selectedIndex} onPress={() => handleEndpointChange(index)} tone={item.method === 'GET' ? 'blue' : 'green'} />)}
        </ScrollView>

        <Card style={styles.endpointCard}>
          <View style={styles.endpointHeader}>
            <Pill label={endpoint.method} tone={endpoint.method === 'GET' ? 'blue' : 'green'} />
            <Text style={styles.endpointPath} selectable>{displayedPath}</Text>
          </View>
          <Text style={styles.endpointTitle}>{endpoint.title}</Text>
          <Text style={styles.endpointDescription}>{endpoint.description}</Text>
          {needsAnimalId ? <TextField label="Path parameter: mooZZLE_id" value={animalId} onChangeText={handleAnimalIdChange} keyboardType="numeric" maxLength={12} /> : null}
        </Card>

        <View style={styles.codeColumns}>
          <CodeCard title="Request schema" code={requestPreview} />
          <View style={styles.sendCard}>
            <Text style={styles.codeTitle}>Demo execution</Text>
            <Text style={styles.sendHint}>This control changes only the prototype response shown below.</Text>
            <PrimaryButton disabled={requestState === 'sending'} label={requestState === 'sending' ? 'SENDING...' : 'Send Request (Demo)'} icon="paper-plane-outline" variant="blue" onPress={handleSend} />
            {requestState === 'sending' ? <ActivityIndicator color={colors.blue} /> : null}
          </View>
        </View>

        {requestError ? (
          <Card style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
            <Text selectable style={styles.errorText}>{requestError}</Text>
            <PrimaryButton label="RETRY REQUEST" variant="outline" onPress={handleSend} />
          </Card>
        ) : null}

        <Card style={styles.responseCard}>
          <View style={styles.responseHeader}>
            <Text style={styles.codeTitle}>Response</Text>
            <Pill label={requestState === 'sent' ? '200 DEMO' : 'Awaiting request'} tone={requestState === 'sent' ? 'green' : 'slate'} />
          </View>
          {responseText ? <JsonCode value={responseText} /> : <View style={styles.emptyResponse}><Ionicons name="terminal-outline" size={24} color={colors.muted} /><Text style={styles.emptyText}>Select an endpoint and send a demo request to inspect the response.</Text></View>}
          <Text selectable style={styles.disclaimer}>{DEMO_DISCLAIMER}</Text>
        </Card>
      </View>
    </AppScreen>
  );
}

function CodeCard({ title, code }: { title: string; code: string }) {
  return <Card style={styles.codeCard}><Text style={styles.codeTitle}>{title}</Text><JsonCode value={code} /></Card>;
}

function JsonCode({ value }: { value: string }) {
  const lines = value.split('\n').reduce<{ line: string; key: string }[]>((items, line) => {
    const occurrence = items.filter((item) => item.line === line).length;
    items.push({ line, key: `${line}-${occurrence}` });
    return items;
  }, []);
  return (
    <View style={styles.codeBlock}>
      {lines.map(({ line, key }) => {
        const colon = line.indexOf(':');
        return (
          <Text selectable style={styles.codeLine} key={key}>
            {colon > -1 ? <><Text style={styles.codeKey}>{line.slice(0, colon + 1)}</Text><Text style={styles.codeValue}>{line.slice(colon + 1)}</Text></> : <Text style={styles.codePunctuation}>{line}</Text>}
          </Text>
        );
      })}
    </View>
  );
}

function createDemoResponse(endpoint: ApiEndpoint, path: string): Record<string, unknown> {
  if (endpoint.id === 'identify') {
    return { success: true, matched: true, mooZZLE_id: '482731905614', animal_type: 'cattle', match_score: 0.94, model_version: 'demo-v1', processing_time_ms: 120, status: 'IDENTIFIED' };
  }
  if (endpoint.id === 'verify') {
    return { success: true, verified: true, mooZZLE_id: '482731905614', match_score: 0.96, status: 'VERIFIED', model_version: 'demo-v1' };
  }
  if (endpoint.id === 'get-animal') {
    return { success: true, mooZZLE_id: path.split('/').pop(), animal_type: 'cattle', biometric_status: 'Enrolled', current_status: 'Active' };
  }
  if (endpoint.id === 'sync') {
    return { success: true, records_uploaded: 12, images_uploaded: 8, errors: 0, status: 'SYNC_COMPLETED' };
  }
  return { success: true, endpoint: path, request_id: 'demo-request-001', status: endpoint.id === 'retire' ? 'RETIRED' : 'ACCEPTED', model_version: 'demo-v1' };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  introCard: { flexDirection: 'row', gap: 11, backgroundColor: '#F0F8FE', borderColor: '#C9E6F7' },
  introIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  introCopy: { flex: 1, gap: 4 },
  eyebrow: { color: colors.blue, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase' },
  introTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 19 },
  introText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  sectionTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 21, paddingHorizontal: 2 },
  endpointScroll: { flexGrow: 0, marginHorizontal: -2 },
  endpointContent: { gap: 8, paddingHorizontal: 2 },
  endpointCard: { gap: 10 },
  endpointHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  endpointPath: { flex: 1, color: colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  endpointTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18 },
  endpointDescription: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  codeColumns: { gap: 14 },
  codeCard: { gap: 10 },
  codeTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  codeBlock: { borderRadius: 11, backgroundColor: '#122331', padding: 12, gap: 2 },
  codeLine: { color: '#E2E8F0', fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  codeKey: { color: '#7DD3FC' },
  codeValue: { color: '#C4F1BE' },
  codePunctuation: { color: '#CBD5E1' },
  sendCard: { borderRadius: 14, borderWidth: 1, borderColor: '#C9E6F7', backgroundColor: '#F0F8FE', padding: 16, gap: 10 },
  sendHint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
  errorCard: { gap: 10, borderColor: '#F3C1C1', backgroundColor: colors.dangerLight },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  responseCard: { gap: 12 },
  responseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  emptyResponse: { minHeight: 120, borderRadius: 11, backgroundColor: colors.slateLight, alignItems: 'center', justifyContent: 'center', padding: 18, gap: 8 },
  emptyText: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  disclaimer: { color: colors.warning, fontFamily: Fonts.semiBold, fontSize: 11, lineHeight: 16 },
});
