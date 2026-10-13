import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from '@/components/translated-text';
import { colors } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';
import { formatRate, THRESHOLD_MAX, THRESHOLD_MIN, THRESHOLD_STEP, type CurvePoint, type EerPoint } from '@/lib/analytics/metrics';
import { FAR_COLOR, FRR_COLOR } from '@/lib/analytics/report';

const HEIGHT = 230;
const PAD = { left: 40, right: 12, top: 16, bottom: 30 };

interface Props {
  points: CurvePoint[];
  eer: EerPoint | null;
  reviewThreshold: number;
  matchThreshold: number;
  selected: number;
  onSelect: (threshold: number) => void;
}

const snap = (t: number) => Math.round(Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, t)) * 100) / 100;

/** FAR vs FRR across thresholds 0.60–0.95. Drag or tap the plot (or use the steppers) to read any threshold. */
export function ThresholdChart({ points, eer, reviewThreshold, matchThreshold, selected, onSelect }: Props) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = useCallback((t: number) => PAD.left + ((t - THRESHOLD_MIN) / (THRESHOLD_MAX - THRESHOLD_MIN)) * plotW, [plotW]);
  const y = useCallback((r: number) => PAD.top + (1 - r) * plotH, [plotH]);

  const paths = useMemo(() => {
    const build = (key: 'far' | 'frr') =>
      points
        .filter((p) => p[key] !== null)
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.threshold).toFixed(1)} ${y(p[key] as number).toFixed(1)}`)
        .join(' ');
    return { far: build('far'), frr: build('frr') };
  }, [points, x, y]);

  const current = points.find((p) => Math.abs(p.threshold - selected) < 0.001) ?? null;

  const pick = useCallback(
    (event: GestureResponderEvent) => {
      if (plotW <= 0) return;
      const ratio = (event.nativeEvent.locationX - PAD.left) / plotW;
      onSelect(snap(THRESHOLD_MIN + ratio * (THRESHOLD_MAX - THRESHOLD_MIN)));
    },
    [onSelect, plotW],
  );

  const step = useCallback((direction: 1 | -1) => onSelect(snap(selected + direction * THRESHOLD_STEP)), [onSelect, selected]);

  const marker = (t: number, label: string, tone: string) =>
    t >= THRESHOLD_MIN && t <= THRESHOLD_MAX ? (
      <>
        <Line x1={x(t)} x2={x(t)} y1={PAD.top} y2={PAD.top + plotH} stroke={tone} strokeWidth={1.5} strokeDasharray="5 4" />
        <Rect x={x(t) - 34} y={PAD.top - 14} width={68} height={14} rx={4} fill={tone} />
        <SvgText x={x(t)} y={PAD.top - 4} fontSize={9} fontWeight="700" fill="#FFFFFF" textAnchor="middle">{label}</SvgText>
      </>
    ) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        <LegendKey color={FAR_COLOR} label="FAR · impostors accepted" />
        <LegendKey color={FRR_COLOR} label="FRR · genuine rejected" />
      </View>
      <View style={styles.readout} accessibilityLiveRegion="polite">
        <Pressable accessibilityRole="button" accessibilityLabel="Lower threshold" onPress={() => step(-1)} style={styles.stepper} disabled={selected <= THRESHOLD_MIN}>
          <Ionicons name="remove" size={18} color={colors.text} />
        </Pressable>
        <View style={styles.readoutCopy}>
          <Text style={styles.readoutLabel}>Threshold</Text>
          <Text selectable style={styles.readoutValue}>{selected.toFixed(2)}</Text>
        </View>
        <View style={styles.readoutCopy}>
          <Text style={styles.readoutLabel}>FAR</Text>
          <Text selectable style={styles.readoutValue}>{formatRate(current?.far ?? null, 3)}</Text>
        </View>
        <View style={styles.readoutCopy}>
          <Text style={styles.readoutLabel}>FRR</Text>
          <Text selectable style={styles.readoutValue}>{formatRate(current?.frr ?? null)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Raise threshold" onPress={() => step(1)} style={styles.stepper} disabled={selected >= THRESHOLD_MAX}>
          <Ionicons name="add" size={18} color={colors.text} />
        </Pressable>
      </View>
      <View
        onLayout={onLayout}
        style={styles.plot}
        accessibilityLabel={`FAR and FRR curve. Equal error rate ${eer ? `${formatRate(eer.rate)} at ${eer.threshold.toFixed(3)}` : 'unavailable'}.`}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={pick}
        onResponderMove={pick}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT} pointerEvents="none">
            {[0, 0.25, 0.5, 0.75, 1].map((r) => (
              <Line key={`g${r}`} x1={PAD.left} x2={width - PAD.right} y1={y(r)} y2={y(r)} stroke={colors.border} strokeWidth={1} />
            ))}
            {[0, 0.5, 1].map((r) => (
              <SvgText key={`yl${r}`} x={PAD.left - 6} y={y(r) + 3} fontSize={9} fill={colors.muted} textAnchor="end">{`${r * 100}%`}</SvgText>
            ))}
            {[0.6, 0.7, 0.8, 0.9].map((t) => (
              <SvgText key={`xl${t}`} x={x(t)} y={HEIGHT - PAD.bottom + 14} fontSize={9} fill={colors.muted} textAnchor="middle">{t.toFixed(2)}</SvgText>
            ))}
            <SvgText x={PAD.left + plotW / 2} y={HEIGHT - 4} fontSize={9} fill={colors.muted} textAnchor="middle">Similarity threshold</SvgText>
            {marker(reviewThreshold, `REVIEW ${reviewThreshold.toFixed(2)}`, colors.warning)}
            {marker(matchThreshold, `CONFIRM ${matchThreshold.toFixed(2)}`, colors.primaryDark)}
            <Path d={paths.far} stroke={FAR_COLOR} strokeWidth={2} fill="none" strokeLinejoin="round" />
            <Path d={paths.frr} stroke={FRR_COLOR} strokeWidth={2} fill="none" strokeLinejoin="round" />
            {eer ? <Circle cx={x(eer.threshold)} cy={y(eer.rate)} r={5} fill={colors.text} stroke="#FFFFFF" strokeWidth={2} /> : null}
            <Line x1={x(selected)} x2={x(selected)} y1={PAD.top} y2={PAD.top + plotH} stroke={colors.text} strokeWidth={1} opacity={0.55} />
            {current?.far !== null && current?.far !== undefined ? <Circle cx={x(selected)} cy={y(current.far)} r={4.5} fill={FAR_COLOR} stroke="#FFFFFF" strokeWidth={2} /> : null}
            {current?.frr !== null && current?.frr !== undefined ? <Circle cx={x(selected)} cy={y(current.frr)} r={4.5} fill={FRR_COLOR} stroke="#FFFFFF" strokeWidth={2} /> : null}
          </Svg>
        ) : null}
      </View>
      <Text style={styles.hint}>
        {eer ? `EER ${formatRate(eer.rate)} where FAR = FRR at threshold ${eer.threshold.toFixed(3)}. ` : ''}Drag across the chart or use − / + to inspect a threshold.
      </Text>
    </View>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 16, height: 3, borderRadius: 2 },
  legendText: { color: colors.text, fontFamily: Fonts.medium, fontSize: 12 },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.slateLight, borderRadius: 12, padding: 6 },
  readoutCopy: { flex: 1, alignItems: 'center' },
  readoutLabel: { color: colors.muted, fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  readoutValue: { color: colors.text, fontFamily: Fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  stepper: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  plot: { height: HEIGHT, width: '100%' },
  hint: { color: colors.muted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
});
