import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { errorText } from '@/components/biometric-ui';
import { Card, colors, OptionChip, PrimaryButton, TextField } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { fetchValidation } from '@/lib/biometric/engine';
import { ENGINE_MODEL, requiredTrials } from '@/lib/biometric/features';
import type { ValidationPayload } from '@/store/types';

const GENUINE = '#059669';
const IMPOSTOR = '#7C3AED';

interface ModelSpec {
  name: string;
  role: string;
  params: string;
  embedding: string;
  latency: string;
  texture: string;
  mobile: string;
  status: string;
  deployed: boolean;
}

/** Candidate architectures. Parameter counts are the published ImageNet backbones; latency is a typical mid-range phone CPU estimate. */
const MODELS: ModelSpec[] = [
  { name: 'CNN Muzzle Detector', role: 'Detect + crop muzzle ROI', params: '≈3–6 M (MobileNet-SSD class)', embedding: '— (bounding box)', latency: '≈40–80 ms', texture: 'n/a — localisation only', mobile: 'High (int8 TFLite)', status: 'Candidate · role filled today by AI Gateway vision', deployed: false },
  { name: 'VGG-16 Texture Baseline', role: 'Ridge/groove texture features', params: '138 M', embedding: '512-D (pooled conv5)', latency: '≈600–1200 ms', texture: 'Good on fine bead patterns; large & slow', mobile: 'Low — server-side only', status: 'Candidate · baseline for comparison', deployed: false },
  { name: 'ResNet50 Deep Feature Extractor', role: 'Metric-learned identity embedding', params: '25.6 M', embedding: '2048-D → 256/512-D projection', latency: '≈180–350 ms', texture: 'Strongest after triplet/ArcFace fine-tuning', mobile: 'Medium (fp16/int8)', status: 'Candidate · needs labelled muzzle dataset', deployed: false },
  { name: ENGINE_MODEL, role: 'Deployed: HOG texture descriptor', params: '0 (hand-crafted)', embedding: '256-D, L2, zero-centred', latency: 'Measured below', texture: 'Moderate; sensitive to pose & crop', mobile: 'High — pure JS on device', status: 'LIVE in this app', deployed: true },
];

export function ModelMatrix({ measuredMs }: { measuredMs: number | null }) {
  return (
    <Card style={styles.card}>
      <Text style={styles.intro}>Reference figures for candidates come from the published backbones, not from runs in this app. Only the deployed engine is measured.</Text>
      {MODELS.map((model) => (
        <View key={model.name} style={[styles.model, model.deployed && styles.modelLive]}>
          <View style={styles.modelHead}>
            <Text style={styles.modelName}>{model.name}</Text>
            <View style={[styles.tag, model.deployed ? styles.tagLive : styles.tagCandidate]}><Text style={[styles.tagText, model.deployed && styles.tagTextLive]}>{model.deployed ? 'LIVE' : 'CANDIDATE'}</Text></View>
          </View>
          <Text style={styles.modelRole}>{model.role}</Text>
          <View style={styles.specGrid}>
            <Spec label="Parameters" value={model.params} />
            <Spec label="Embedding" value={model.embedding} />
            <Spec label="Latency" value={model.deployed && measuredMs ? `${measuredMs} ms avg (real scans, incl. AI detection)` : model.latency} />
            <Spec label="Mobile feasibility" value={model.mobile} />
            <Spec label="Texture discrimination" value={model.texture} wide />
          </View>
          <Text style={styles.status}>{model.status}</Text>
        </View>
      ))}
    </Card>
  );
}

function Spec({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <View style={[styles.spec, wide && styles.specWide]}><Text style={styles.specLabel}>{label}</Text><Text selectable style={styles.specValue}>{value}</Text></View>;
}

interface Rates { far: number; frr: number; genuine: number; impostor: number; fa: number; fr: number }

function ratesAt(pairs: ValidationPayload['pairs'], t: number, group?: string): Rates {
  let genuine = 0;
  let impostor = 0;
  let fa = 0;
  let fr = 0;
  for (const [g, s, grp] of pairs) {
    if (group && grp !== group) continue;
    if (g === 1) {
      genuine += 1;
      if (s < t) fr += 1;
    } else {
      impostor += 1;
      if (s >= t) fa += 1;
    }
  }
  return { far: impostor ? fa / impostor : 0, frr: genuine ? fr / genuine : 0, genuine, impostor, fa, fr };
}

const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 3 : 1)}%`;
const MODES: { key: ValidationPayload['mode']; label: string }[] = [
  { key: 'overall', label: 'All pairs' },
  { key: 'cross_breed', label: 'Cross-breed' },
  { key: 'cross_lighting', label: 'Cross-lighting' },
];

export function LiveValidation({ onLoaded }: { onLoaded?: (data: ValidationPayload) => void }) {
  const [mode, setMode] = useState<ValidationPayload['mode']>('overall');
  const [data, setData] = useState<ValidationPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [matchT, setMatchT] = useState(0.85);
  const [reviewT, setReviewT] = useState(0.7);

  const run = useCallback(async (next: ValidationPayload['mode']) => {
    setMode(next);
    setLoading(true);
    setError('');
    try {
      const result = await fetchValidation(next);
      setData(result);
      setMatchT(Number(result.match_threshold));
      setReviewT(Number(result.review_threshold));
      onLoaded?.(result);
    } catch (caught) {
      console.error('Validation run failed', caught);
      setError(errorText(caught, 'The validation run could not be completed.'));
    } finally {
      setLoading(false);
    }
  }, [onLoaded]);

  const summary = useMemo(() => {
    if (!data) return null;
    const atMatch = ratesAt(data.pairs, matchT);
    const atReview = ratesAt(data.pairs, reviewT);
    let eer = { t: 0, v: 0 };
    let bestGap = Number.POSITIVE_INFINITY;
    const roc: [number, number][] = [];
    for (let step = 0; step <= 120; step += 1) {
      const t = -0.2 + step * 0.01;
      const r = ratesAt(data.pairs, t);
      roc.push([r.far, 1 - r.frr]);
      const gap = Math.abs(r.far - r.frr);
      if (gap < bestGap) {
        bestGap = gap;
        eer = { t, v: (r.far + r.frr) / 2 };
      }
    }
    const groups = Array.from(new Set(data.pairs.map((p) => p[2]))).sort();
    return { atMatch, atReview, eer, roc, groups };
  }, [data, matchT, reviewT]);

  return (
    <Card style={styles.card}>
      <Text style={styles.intro}>Runs on the server over every enrolled live-engine template: pairs from the same animal are genuine trials, pairs from different animals are impostor trials.</Text>
      <View style={styles.chips}>{MODES.map((m) => <OptionChip key={m.key} label={m.label} selected={mode === m.key} onPress={() => setMode(m.key)} tone="blue" />)}</View>
      <PrimaryButton label={loading ? 'Running…' : data ? 'Re-run Validation' : 'Run Validation Test'} icon="flask-outline" variant="blue" onPress={() => void run(mode)} disabled={loading} />
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.intro}>Comparing template pairs…</Text></View> : null}
      {error ? <View style={styles.errorBox}><Text selectable style={styles.errorText}>{error}</Text><PrimaryButton label="Retry" variant="outline" onPress={() => void run(mode)} style={styles.retry} /></View> : null}
      {data && summary && !loading ? (
        data.pairs.length === 0 || summary.atMatch.genuine === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="file-tray-outline" size={26} color={colors.muted} />
            <Text style={styles.emptyTitle}>Not enough enrolled data yet</Text>
            <Text style={styles.intro}>{data.templates} live templates from {data.animals} animal(s). Genuine trials need an animal enrolled with ≥2 frames; impostor trials need ≥2 animals. Enrol animals with the Register wizard to populate this test.</Text>
          </View>
        ) : (
          <>
            <View style={styles.kpis}>
              <Kpi label="Genuine trials" value={String(summary.atMatch.genuine)} />
              <Kpi label="Impostor trials" value={String(summary.atMatch.impostor)} />
              <Kpi label={`FAR @ ${matchT.toFixed(2)}`} value={pct(summary.atMatch.far)} sub={`${summary.atMatch.fa} false accepts`} />
              <Kpi label={`FRR @ ${matchT.toFixed(2)}`} value={pct(summary.atMatch.frr)} sub={`${summary.atMatch.fr} false rejects`} />
              <Kpi label="EER (approx.)" value={pct(summary.eer.v)} sub={`at ${summary.eer.t.toFixed(2)}`} />
              <Kpi label="Live scans logged" value={String(data.scans.total)} sub={`${data.scans.match} match · ${data.scans.uncertain} uncertain · ${data.scans.no_match} none`} />
            </View>
            <ThresholdRow label="1:N match threshold" value={matchT} onChange={setMatchT} min={reviewT + 0.01} />
            <ThresholdRow label="Candidate review threshold" value={reviewT} onChange={setReviewT} max={matchT - 0.01} />
            <Text style={styles.small}>What-if only: rates above recompute locally. Platform thresholds (1:1 verify {Number(data.verify_threshold).toFixed(2)}) are changed by a privileged administrator in Platform Settings, with an audit reason.</Text>
            <Text style={styles.chartTitle}>Genuine vs impostor score distribution</Text>
            <Histogram pairs={data.pairs} matchT={matchT} reviewT={reviewT} />
            <Text style={styles.chartTitle}>ROC curve (true accept rate vs false accept rate)</Text>
            <RocChart points={summary.roc} />
            {mode !== 'overall' ? (
              <View style={styles.table}>
                <View style={[styles.tr, styles.th]}><Text style={[styles.td, styles.tdWide, styles.thText]}>Group</Text><Text style={[styles.td, styles.thText]}>Genuine</Text><Text style={[styles.td, styles.thText]}>Impostor</Text><Text style={[styles.td, styles.thText]}>FAR</Text><Text style={[styles.td, styles.thText]}>FRR</Text></View>
                {summary.groups.map((group) => {
                  const r = ratesAt(data.pairs, matchT, group);
                  return <View key={group} style={styles.tr}><Text style={[styles.td, styles.tdWide]}>{group}</Text><Text style={styles.td}>{r.genuine}</Text><Text style={styles.td}>{r.impostor}</Text><Text style={styles.td}>{r.impostor ? pct(r.far) : '—'}</Text><Text style={styles.td}>{r.genuine ? pct(r.frr) : '—'}</Text></View>;
                })}
              </View>
            ) : null}
            <View style={styles.disclosure}><Ionicons name="alert-circle-outline" size={16} color={colors.warning} /><Text style={styles.disclosureText}>Honest benchmark: {summary.atMatch.impostor.toLocaleString('en-IN')} impostor trials from {data.animals} enrolled animals, all collected through this app. Pairs from the same enrolment session are optimistic; independent re-captures on different days are needed before any accuracy claim.</Text></View>
          </>
        )
      ) : null}
    </Card>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <View style={styles.kpi}><Text selectable style={styles.kpiValue}>{value}</Text><Text style={styles.kpiLabel}>{label}</Text>{sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}</View>;
}

function ThresholdRow({ label, value, onChange, min = 0.5, max = 0.99 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const set = (v: number) => onChange(Math.round(Math.max(min, Math.min(max, v)) * 100) / 100);
  return (
    <View style={styles.thRow}>
      <Text style={styles.thLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Lower ${label}`} onPress={() => set(value - 0.01)} style={styles.step}><Ionicons name="remove" size={18} color={colors.primary} /></Pressable>
      <Text selectable style={styles.thValue}>{value.toFixed(2)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Raise ${label}`} onPress={() => set(value + 0.01)} style={styles.step}><Ionicons name="add" size={18} color={colors.primary} /></Pressable>
    </View>
  );
}

const BIN_MIN = -0.2;
const BIN_W = 0.05;
const BIN_N = 24;

function Histogram({ pairs, matchT, reviewT }: { pairs: ValidationPayload['pairs']; matchT: number; reviewT: number }) {
  const [active, setActive] = useState<number | null>(null);
  const bins = useMemo(() => {
    const g = new Array<number>(BIN_N).fill(0);
    const i = new Array<number>(BIN_N).fill(0);
    let gn = 0;
    let im = 0;
    for (const [isG, s] of pairs) {
      const b = Math.max(0, Math.min(BIN_N - 1, Math.floor((s - BIN_MIN) / BIN_W)));
      if (isG === 1) { g[b] += 1; gn += 1; } else { i[b] += 1; im += 1; }
    }
    const gs = g.map((v) => (gn ? v / gn : 0));
    const is = i.map((v) => (im ? v / im : 0));
    const peak = Math.max(0.0001, ...gs, ...is);
    return { g, i, gs, is, peak };
  }, [pairs]);
  const lo = (b: number) => BIN_MIN + b * BIN_W;
  return (
    <View style={styles.hist}>
      <View style={styles.legend}><View style={[styles.swatch, { backgroundColor: GENUINE }]} /><Text style={styles.legendText}>Genuine (same animal)</Text><View style={[styles.swatch, { backgroundColor: IMPOSTOR }]} /><Text style={styles.legendText}>Impostor (different animals)</Text></View>
      <View style={styles.histPlot}>
        {bins.gs.map((gShare, b) => {
          const inMatch = lo(b) >= matchT - 1e-9;
          const inReview = !inMatch && lo(b) + BIN_W > reviewT;
          return (
            <Pressable key={`bin-${lo(b).toFixed(2)}`} accessibilityRole="button" accessibilityLabel={`Scores ${lo(b).toFixed(2)} to ${(lo(b) + BIN_W).toFixed(2)}`} onPress={() => setActive(active === b ? null : b)} style={[styles.binHit, active === b && styles.binActive, inMatch && styles.binMatch, inReview && styles.binReview]}>
              <View style={styles.binBars}>
                <View style={[styles.bar, { height: `${(gShare / bins.peak) * 100}%`, backgroundColor: GENUINE }]} />
                <View style={[styles.bar, { height: `${(bins.is[b] / bins.peak) * 100}%`, backgroundColor: IMPOSTOR }]} />
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axis}><Text style={styles.axisText}>{BIN_MIN.toFixed(1)}</Text><Text style={styles.axisText}>0.4</Text><Text style={styles.axisText}>1.0</Text></View>
      <Text selectable style={styles.readout}>{active === null ? 'Tap a bin for counts. Amber band = review zone, green band = confirmed match zone.' : `Similarity ${lo(active).toFixed(2)}–${(lo(active) + BIN_W).toFixed(2)}: genuine ${bins.g[active]} (${pct(bins.gs[active])}) · impostor ${bins.i[active]} (${pct(bins.is[active])})`}</Text>
    </View>
  );
}

function RocChart({ points }: { points: [number, number][] }) {
  const [width, setWidth] = useState(300);
  const height = 190;
  const pad = 28;
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const w = Math.max(120, width - pad - 8);
  const h = height - pad - 8;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const poly = sorted.map(([x, y]) => `${pad + x * w},${8 + (1 - y) * h}`).join(' ');
  return (
    <View onLayout={onLayout} style={styles.roc}>
      <Svg width={width} height={height}>
        <Line x1={pad} y1={8 + h} x2={pad + w} y2={8 + h} stroke={colors.border} strokeWidth={1} />
        <Line x1={pad} y1={8} x2={pad} y2={8 + h} stroke={colors.border} strokeWidth={1} />
        <Line x1={pad} y1={8 + h} x2={pad + w} y2={8} stroke={colors.border} strokeWidth={1} strokeDasharray="4 4" />
        <Polyline points={poly} fill="none" stroke={GENUINE} strokeWidth={2} />
        {sorted.length ? <Circle cx={pad + sorted[0][0] * w} cy={8 + (1 - sorted[0][1]) * h} r={4} fill={GENUINE} stroke={colors.surface} strokeWidth={2} /> : null}
        <SvgText x={pad} y={height - 4} fontSize={10} fill={colors.muted}>0</SvgText>
        <SvgText x={pad + w - 40} y={height - 4} fontSize={10} fill={colors.muted}>FAR 1.0</SvgText>
        <SvgText x={2} y={16} fontSize={10} fill={colors.muted}>TAR</SvgText>
      </Svg>
    </View>
  );
}

export function SampleSizeCard({ impostorTrials }: { impostorTrials: number | null }) {
  const [far, setFar] = useState('0.0001');
  const [conf, setConf] = useState('0.95');
  const n = requiredTrials(Number(far), Number(conf));
  const progress = impostorTrials !== null && n > 0 ? Math.min(1, impostorTrials / n) : 0;
  return (
    <Card style={styles.card}>
      <Text style={styles.intro}>A 99.99% research target means FAR ≤ 0.01%. If N independent impostor trials produce zero false acceptances, the one-sided upper bound on FAR at confidence c is 1 − (1 − c)^(1/N). For FAR 0.0001 at 95% confidence this needs N ≈ 29,956 — about 30,000 trials from distinct animal pairs, with zero false accepts.</Text>
      <View style={styles.fieldRow}>
        <TextField label="Target FAR" value={far} onChangeText={setFar} keyboardType="decimal-pad" style={styles.flex} />
        <TextField label="Confidence" value={conf} onChangeText={setConf} keyboardType="decimal-pad" style={styles.flex} />
      </View>
      <View style={styles.bigRow}><Text selectable style={styles.big}>{n > 0 ? n.toLocaleString('en-IN') : '—'}</Text><Text style={styles.intro}>{n > 0 ? 'impostor trials required (zero false accepts)' : 'Enter FAR and confidence between 0 and 1.'}</Text></View>
      <View style={styles.track}><View style={[styles.fill, { width: `${progress * 100}%` }]} /></View>
      <Text style={styles.small}>{impostorTrials === null ? 'Run the validation test above to count collected impostor trials.' : `${impostorTrials.toLocaleString('en-IN')} collected (${(progress * 100).toFixed(2)}%). One false accept would raise the requirement to ≈${n > 0 ? Math.ceil(4.74 / Number(far)).toLocaleString('en-IN') : '—'} trials (95%, k = 1).`}</Text>
      <PrimaryButton label="Open Platform Settings" icon="options-outline" variant="outline" onPress={() => router.push('/platform-settings')} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 12 },
  intro: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19 },
  small: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 16 },
  model: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 6 },
  modelLive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  modelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  modelName: { flex: 1, color: colors.text, fontFamily: Fonts.bold, fontSize: 14 },
  modelRole: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 12 },
  tag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagLive: { backgroundColor: colors.primary },
  tagCandidate: { backgroundColor: colors.slateLight },
  tagText: { color: colors.muted, fontFamily: Fonts.bold, fontSize: 9, letterSpacing: 0.8 },
  tagTextLive: { color: colors.surface },
  specGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  spec: { width: '50%', paddingRight: 8, gap: 2 },
  specWide: { width: '100%' },
  specLabel: { color: colors.muted, fontFamily: Fonts.medium, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  specValue: { color: colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  status: { color: colors.blue, fontFamily: Fonts.semiBold, fontSize: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  center: { alignItems: 'center', gap: 6, paddingVertical: 10 },
  errorBox: { gap: 8, backgroundColor: colors.dangerLight, borderRadius: 10, padding: 10 },
  errorText: { color: colors.danger, fontFamily: Fonts.medium, fontSize: 13 },
  retry: { alignSelf: 'flex-start', minHeight: 44 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 12 },
  emptyTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { flexGrow: 1, flexBasis: '30%', minWidth: 100, backgroundColor: colors.background, borderRadius: 10, padding: 10, gap: 2 },
  kpiValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 18, fontVariant: ['tabular-nums'] },
  kpiLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 11 },
  kpiSub: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 10 },
  thRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thLabel: { flex: 1, color: colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  thValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15, width: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
  step: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  chartTitle: { color: colors.text, fontFamily: Fonts.bold, fontSize: 14, marginTop: 4 },
  hist: { gap: 6 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { color: colors.text, fontFamily: Fonts.medium, fontSize: 11, marginRight: 8 },
  histPlot: { height: 140, flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: colors.border },
  binHit: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 1 },
  binActive: { backgroundColor: colors.slateLight },
  binMatch: { backgroundColor: '#ECFDF5' },
  binReview: { backgroundColor: '#FFFBEB' },
  binBars: { height: '100%', flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  bar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2, minHeight: 0 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 10 },
  readout: { color: colors.text, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17 },
  roc: { width: '100%' },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, minHeight: 36, alignItems: 'center' },
  th: { backgroundColor: colors.slateLight, borderTopWidth: 0 },
  thText: { fontFamily: Fonts.bold, color: colors.muted },
  td: { flex: 1, paddingHorizontal: 6, color: colors.text, fontFamily: Fonts.medium, fontSize: 11, fontVariant: ['tabular-nums'] },
  tdWide: { flex: 1.8 },
  disclosure: { flexDirection: 'row', gap: 7, backgroundColor: colors.warningLight, padding: 10, borderRadius: 10 },
  disclosureText: { flex: 1, color: '#92400E', fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  bigRow: { gap: 2 },
  big: { color: colors.primary, fontFamily: Fonts.bold, fontSize: 30, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.slateLight, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
});
