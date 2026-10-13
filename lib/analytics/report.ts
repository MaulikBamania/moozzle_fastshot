import { toCsv } from '@/lib/export';
import {
  benchmark,
  FAR_TARGET,
  formatRate,
  formatScore,
  formatTimestamp,
  FRR_TARGET,
  SCAN_TYPE_LABELS,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  verdictOf,
  type CurvePoint,
  type EerPoint,
  type RateSummary,
} from '@/lib/analytics/metrics';
import type { ScanAnalyticsRow } from '@/store/types';

export const FAR_COLOR = '#2563EB';
export const FRR_COLOR = '#C2410C';

export interface ReportInput {
  summary: RateSummary;
  points: CurvePoint[];
  eer: EerPoint | null;
  curveSource: string;
  rows: ScanAnalyticsRow[];
  rangeLabel: string;
  speciesLabel: string;
  scopeLabel: string;
  matchThreshold: number;
  reviewThreshold: number;
  verifyThreshold: number;
  preparedBy: string;
  generatedAt: Date;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fileStamp = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
export const reportFileName = (date: Date) => `MOOZZLE_FRR_FAR_Report_${fileStamp(date)}.pdf`;
export const csvFileName = (date: Date) => `MOOZZLE_Scan_Telemetry_${fileStamp(date)}.csv`;

/** Static SVG of the FAR / FRR curves for the printed report. */
function curveSvg(points: CurvePoint[], eer: EerPoint | null, review: number, match: number): string {
  const w = 680;
  const h = 250;
  const left = 44;
  const right = 14;
  const top = 14;
  const bottom = 34;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const x = (t: number) => left + ((t - THRESHOLD_MIN) / (THRESHOLD_MAX - THRESHOLD_MIN)) * pw;
  const y = (r: number) => top + (1 - r) * ph;
  const line = (key: 'far' | 'frr') => {
    const segs = points.filter((p) => p[key] !== null).map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.threshold).toFixed(1)} ${y(p[key] as number).toFixed(1)}`);
    return segs.join(' ');
  };
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((r) => `<line x1="${left}" x2="${w - right}" y1="${y(r)}" y2="${y(r)}" stroke="#e5e7eb" stroke-width="1"/><text x="${left - 6}" y="${y(r) + 3}" font-size="9" fill="#64748b" text-anchor="end">${r * 100}%</text>`)
    .join('');
  const ticks = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
    .map((t) => `<text x="${x(t)}" y="${h - bottom + 14}" font-size="9" fill="#64748b" text-anchor="middle">${t.toFixed(2)}</text>`)
    .join('');
  const marker = (t: number, label: string) =>
    t >= THRESHOLD_MIN && t <= THRESHOLD_MAX
      ? `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top + ph}" stroke="#0f172a" stroke-width="1" stroke-dasharray="4 3"/><text x="${x(t) + 4}" y="${top + 10}" font-size="9" fill="#0f172a" font-weight="700">${label}</text>`
      : '';
  const eerDot = eer ? `<circle cx="${x(eer.threshold)}" cy="${y(eer.rate)}" r="5" fill="#0f172a" stroke="#fff" stroke-width="2"/><text x="${x(eer.threshold) + 8}" y="${y(eer.rate) - 6}" font-size="9" font-weight="700" fill="#0f172a">EER ${formatRate(eer.rate)} @ ${eer.threshold.toFixed(3)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${grid}${ticks}
    <text x="${left + pw / 2}" y="${h - 4}" font-size="9.5" fill="#334155" text-anchor="middle">Similarity decision threshold</text>
    ${marker(review, `Review ${review.toFixed(2)}`)}${marker(match, `Confirmed ${match.toFixed(2)}`)}
    <path d="${line('far')}" fill="none" stroke="${FAR_COLOR}" stroke-width="2"/>
    <path d="${line('frr')}" fill="none" stroke="${FRR_COLOR}" stroke-width="2"/>${eerDot}</svg>`;
}

function benchmarkCell(value: number | null, target: number): string {
  const state = benchmark(value, target);
  const label = state === 'pass' ? 'Meets target' : state === 'fail' ? 'Above target' : 'Insufficient labelled trials';
  const color = state === 'pass' ? '#047857' : state === 'fail' ? '#b91c1c' : '#64748b';
  return `<span style="color:${color};font-weight:700">${label}</span>`;
}

export function buildReportHtml(input: ReportInput): string {
  const s = input.summary;
  const kpi = (label: string, value: string, note: string) => `<div class="kpi"><div class="kl">${esc(label)}</div><div class="kv">${esc(value)}</div><div class="kn">${note}</div></div>`;
  const matrixRows = input.points
    .filter((p) => Math.round(p.threshold * 100) % 5 === 0)
    .map((p) => {
      const op = Math.abs(p.threshold - input.matchThreshold) < 0.001 ? ' (Confirmed)' : Math.abs(p.threshold - input.reviewThreshold) < 0.001 ? ' (Review)' : '';
      return `<tr${op ? ' class="op"' : ''}><td>${p.threshold.toFixed(2)}${op}</td><td>${formatRate(p.far)}</td><td>${p.falseAccepts}</td><td>${formatRate(p.frr)}</td><td>${p.falseRejects}</td></tr>`;
    })
    .join('');
  const logRows = input.rows
    .slice(0, 300)
    .map((r) => `<tr><td>${esc(formatTimestamp(r.created_at))}</td><td>${esc(r.moozzle_id ?? '—')}</td><td>${esc(SCAN_TYPE_LABELS[r.scan_type])}</td><td>${formatScore(r.similarity)}</td><td>${esc(r.outcome.replace('_', ' '))}</td><td>${formatScore(r.quality_score)}</td><td>${esc(verdictOf(r))}</td></tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=794"/><title>MOOZZLE FRR / FAR Report</title><style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; font-size: 10.5px; }
  #page { width: 794px; padding: 28px 34px; background: #fff; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #047857; padding-bottom: 10px; }
  .brand { font-size: 24px; font-weight: 800; color: #14284b; letter-spacing: 1px; }
  .sub { color: #047857; font-weight: 700; font-size: 11px; letter-spacing: .6px; }
  .meta { text-align: right; color: #475569; font-size: 10px; line-height: 1.5; }
  h2 { font-size: 13px; color: #047857; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: .6px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; }
  .kpi { flex: 1 1 22%; border: 1px solid #d1e7dc; background: #f6fbf8; border-radius: 8px; padding: 9px 10px; }
  .kl { color: #475569; font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
  .kv { font-size: 19px; font-weight: 800; margin: 2px 0; font-variant-numeric: tabular-nums; }
  .kn { font-size: 9px; color: #64748b; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { background: #ecfdf5; color: #065f46; text-align: left; font-size: 9.5px; padding: 5px 6px; border-bottom: 1px solid #a7f3d0; }
  td { padding: 4px 6px; border-bottom: 1px solid #eef2f7; font-size: 9.5px; }
  tr.op td { background: #fef9c3; font-weight: 700; }
  .legend { display: flex; gap: 16px; font-size: 10px; margin: 4px 0 6px; }
  .sw { display: inline-block; width: 14px; height: 3px; vertical-align: middle; margin-right: 5px; border-radius: 2px; }
  .note { color: #64748b; font-size: 9.5px; line-height: 1.5; margin-top: 6px; }
  .cm { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; max-width: 420px; }
  .cm div { border-radius: 6px; padding: 8px; font-weight: 700; }
  tr { page-break-inside: avoid; }
</style></head><body><div id="page">
  <div class="hdr">
    <div><div class="brand">MOOZZLE</div><div class="sub">BIOMETRIC SCAN ANALYTICS · FRR / FAR REPORT</div></div>
    <div class="meta">Generated ${esc(formatTimestamp(input.generatedAt.toISOString()))}<br/>Prepared by ${esc(input.preparedBy)}<br/>Scope: ${esc(input.scopeLabel)} · Range: ${esc(input.rangeLabel)} · Species: ${esc(input.speciesLabel)}</div>
  </div>

  <h2>Executive summary</h2>
  <div class="kpis">
    ${kpi('False Acceptance Rate', formatRate(s.far, 3), `${s.fp} of ${s.impostor} impostor trials · target &lt; 0.01% · ${benchmarkCell(s.far, FAR_TARGET)}`)}
    ${kpi('False Rejection Rate', formatRate(s.frr), `${s.fn} of ${s.genuine} genuine trials · target &lt; 1.0% · ${benchmarkCell(s.frr, FRR_TARGET)}`)}
    ${kpi('Equal Error Rate', input.eer ? formatRate(input.eer.rate) : '—', input.eer ? `at threshold ${input.eer.threshold.toFixed(3)} (${esc(input.curveSource)})` : 'needs genuine and impostor trials')}
    ${kpi('Accuracy', formatRate(s.accuracy), `${s.tp + s.tn} correct of ${s.genuine + s.impostor} labelled`)}
    ${kpi('Precision', formatRate(s.precision), 'True Match / all accepts')}
    ${kpi('Recall', formatRate(s.recall), 'True Match / genuine trials')}
    ${kpi('F1 Score', s.f1 === null ? '—' : s.f1.toFixed(3), 'Harmonic mean of precision &amp; recall')}
    ${kpi('Scans in report', String(input.rows.length), `${s.genuine + s.impostor} with verified ground truth`)}
  </div>

  <h2>Confusion matrix (operational decision)</h2>
  <div class="cm">
    <div style="background:#dcfce7;color:#166534">True Match: ${s.tp}</div>
    <div style="background:#fee2e2;color:#991b1b">False Reject: ${s.fn}</div>
    <div style="background:#fee2e2;color:#991b1b">False Accept: ${s.fp}</div>
    <div style="background:#dcfce7;color:#166534">True Non-Match: ${s.tn}</div>
  </div>
  <div class="note">An accept is a Confirmed match (1:N ≥ ${input.matchThreshold.toFixed(2)}, 1:1 ≥ ${input.verifyThreshold.toFixed(2)}). Review (≥ ${input.reviewThreshold.toFixed(2)}) and No-match scans are counted as rejections.</div>

  <h2>Decision threshold curve — ${esc(input.curveSource)}</h2>
  <div class="legend"><span><span class="sw" style="background:${FAR_COLOR}"></span>FAR (impostors accepted)</span><span><span class="sw" style="background:${FRR_COLOR}"></span>FRR (genuine rejected)</span></div>
  ${curveSvg(input.points, input.eer, input.reviewThreshold, input.matchThreshold)}

  <h2>Decision threshold matrix</h2>
  <table><thead><tr><th>Threshold</th><th>FAR</th><th>False accepts</th><th>FRR</th><th>False rejects</th></tr></thead><tbody>${matrixRows}</tbody></table>

  <h2>Biometric scan audit log${input.rows.length > 300 ? ' (newest 300 of ' + input.rows.length + ')' : ''}</h2>
  ${input.rows.length ? `<table><thead><tr><th>Timestamp</th><th>Animal ID</th><th>Scan type</th><th>Similarity</th><th>Outcome</th><th>Quality</th><th>Ground truth</th></tr></thead><tbody>${logRows}</tbody></table>` : '<div class="note">No scans in this range.</div>'}
  <div class="note">FAR / FRR are computed only from scans whose ground truth was verified by an authorised reviewer. Unlabelled scans are listed but excluded from error rates. Out-of-scope animal IDs are masked.</div>
</div></body></html>`;
}

export function buildCsv(rows: ScanAnalyticsRow[]): string {
  return toCsv(
    ['scan_id', 'timestamp_utc', 'animal_id', 'species', 'scan_type', 'similarity_score', 'outcome', 'decision', 'quality_score', 'quality_status', 'processing_ms', 'templates_searched', 'frames', 'scanner_role', 'ground_truth', 'verdict', 'labelled_at', 'review_note'],
    rows.map((r) => [
      r.id,
      r.created_at,
      r.moozzle_id ?? '',
      r.species ?? '',
      SCAN_TYPE_LABELS[r.scan_type],
      r.similarity ?? '',
      r.outcome,
      r.outcome === 'match' ? 'accept' : 'reject',
      r.quality_score ?? '',
      r.quality_status,
      r.processing_ms ?? '',
      r.templates_searched,
      r.frames,
      r.user_role,
      r.ground_truth ?? '',
      verdictOf(r),
      r.labelled_at ?? '',
      r.ground_truth_note ?? '',
    ]),
  );
}
