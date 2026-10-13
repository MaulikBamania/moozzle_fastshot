import { useCallback, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { Text } from '@/components/translated-text';
import { colors } from '@/components/moozzle-ui';
import { Fonts } from '@/constants/Typography';

export interface ChartSeries {
  label: string;
  color: string;
  /** [x, y] in data units. */
  points: [number, number][];
  dashed?: boolean;
}

interface Props {
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  xDomain: [number, number];
  yDomain?: [number, number];
  /** Vertical reference lines, e.g. the operating threshold. */
  markers?: { x: number; label: string }[];
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  height?: number;
  accessibilityLabel: string;
}

const PAD = { left: 42, right: 12, top: 14, bottom: 34 };
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Single-axis line chart with a legend; identity never relies on colour alone (legend + dash). */
export function LineChart({ series, xLabel, yLabel, xDomain, yDomain = [0, 1], markers = [], formatX = (v) => v.toFixed(2), formatY = pct, height = 220, accessibilityLabel }: Props) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = useCallback((v: number) => PAD.left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * plotW, [plotW, xDomain]);
  const y = useCallback((v: number) => PAD.top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * plotH, [plotH, yDomain]);
  const paths = useMemo(
    () => series.map((s) => s.points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${x(px).toFixed(1)} ${y(py).toFixed(1)}`).join(' ')),
    [series, x, y],
  );
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => xDomain[0] + f * (xDomain[1] - xDomain[0]));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yDomain[0] + f * (yDomain[1] - yDomain[0]));
  return (
    <View style={styles.wrap} accessibilityLabel={accessibilityLabel}>
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: s.color }, s.dashed && styles.swatchDashed]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
      <View onLayout={onLayout} style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {yTicks.map((t) => (
              <Line key={`y${t}`} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
            ))}
            {yTicks.map((t) => (
              <SvgText key={`yl${t}`} x={PAD.left - 6} y={y(t) + 3} fontSize={9} fill={colors.muted} textAnchor="end">{formatY(t)}</SvgText>
            ))}
            {xTicks.map((t) => (
              <SvgText key={`xl${t}`} x={x(t)} y={height - PAD.bottom + 14} fontSize={9} fill={colors.muted} textAnchor="middle">{formatX(t)}</SvgText>
            ))}
            <SvgText x={PAD.left + plotW / 2} y={height - 4} fontSize={10} fill={colors.text} textAnchor="middle">{xLabel}</SvgText>
            <SvgText x={10} y={PAD.top + plotH / 2} fontSize={10} fill={colors.text} textAnchor="middle" transform={`rotate(-90 10 ${PAD.top + plotH / 2})`}>{yLabel}</SvgText>
            {markers.filter((m) => m.x >= xDomain[0] && m.x <= xDomain[1]).map((m) => (
              <Line key={`m${m.label}`} x1={x(m.x)} x2={x(m.x)} y1={PAD.top} y2={PAD.top + plotH} stroke={colors.text} strokeWidth={1} strokeDasharray="4 3" />
            ))}
            {markers.filter((m) => m.x >= xDomain[0] && m.x <= xDomain[1]).map((m) => (
              <SvgText key={`ml${m.label}`} x={x(m.x) + 4} y={PAD.top + 10} fontSize={9} fontWeight="700" fill={colors.text}>{m.label}</SvgText>
            ))}
            {series.map((s, i) => (
              <Path key={s.label} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 16, height: 3, borderRadius: 2 },
  swatchDashed: { width: 10 },
  legendText: { color: colors.text, fontFamily: Fonts.medium, fontSize: 12 },
});
