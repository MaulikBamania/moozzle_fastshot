import { proposalError } from '@/lib/analytics/governance';
import { falseSelectionRate, FSA_DEFINITION } from '@/lib/analytics/fsa-definition';
import { assessGoal, GOALS } from '@/lib/analytics/goals';
import { cmc, galleryProjection, identificationSummary, type IdentificationTrial, projectFpir } from '@/lib/analytics/identification';
import { operationalSummary } from '@/lib/analytics/operational';
import { ruleOfThree, trialsForTarget, upperBound95, wilson } from '@/lib/analytics/statistics';
import { eerFromRoc, rocPoints, verificationSummary, verificationTrials } from '@/lib/analytics/verification';
import { decisionForOutcome, DECISION_COPY } from '@/lib/biometric/decision';
import { classifyBiometricError, ServiceUnavailableError } from '@/lib/biometric/errors';
import { assessQuality, EMPTY_DETECTION, GOOD_STATUS } from '@/lib/biometric/quality';
import { canApproveThresholds, canOpen, canProposeThresholds, defaultPermissions } from '@/lib/rbac';
import type { AcquisitionEventRow, MuzzleDetection, QualityMetrics, ScanAnalyticsRow } from '@/store/types';

function scan(over: Partial<ScanAnalyticsRow>): ScanAnalyticsRow {
  return {
    id: Math.random().toString(36), created_at: new Date().toISOString(), scan_type: 'verify', outcome: 'no_match', similarity: 0.5, quality_score: 0.8,
    quality_status: 'GOOD IMAGE — READY TO SCAN', processing_ms: 100, templates_searched: 100, frames: 1, user_role: 'Researcher', own: true,
    moozzle_id: null, animal_in_scope: false, species: null, species_code: null, breed: null, age_group: null, ground_truth: null, ground_truth_note: null,
    labelled_at: null, decision_reason: 'below_review_threshold', mated: null, mate_rank: null, candidate_scores: [], config_version: 1, model_version: 'MOOZZLE-TextureHOG-v1',
    data_source: 'laboratory', test_session_id: null, device_model: 'web · camera', capture_condition: 'normal', review_status: 'none', review_decision: null, can_label: true,
    ...over,
  };
}

describe('statistics', () => {
  it('computes a Wilson interval that contains the point estimate', () => {
    const p = wilson(5, 100);
    expect(p.rate).toBeCloseTo(0.05);
    expect(p.low).toBeLessThan(0.05);
    expect(p.high).toBeGreaterThan(0.05);
  });
  it('never reports zero risk for zero observed errors', () => {
    const p = wilson(0, 1000);
    expect(p.rate).toBe(0);
    expect(upperBound95(p)).toBeGreaterThanOrEqual(ruleOfThree(1000) ?? 0);
    expect(ruleOfThree(1000)).toBeCloseTo(0.003);
  });
  it('sizes the FAR goal by the rule of three', () => {
    expect(trialsForTarget(GOALS.far.target ?? 0)).toBe(3_000_000);
    expect(GOALS.frr.target).toBe(0.05);
  });
  it('only marks a goal supported when the upper bound is below it', () => {
    expect(assessGoal(wilson(0, 40), 0.05)).toBe('not_demonstrated');
    expect(assessGoal(wilson(0, 1000), 0.05)).toBe('supported');
    expect(assessGoal(wilson(40, 100), 0.05)).toBe('not_met');
    expect(assessGoal(wilson(0, 0), 0.05)).toBe('no_data');
    expect(assessGoal(wilson(1, 100), null)).toBe('no_target');
  });
});

describe('1:1 verification metrics are separate from 1:N', () => {
  const rows = [
    scan({ ground_truth: 'genuine', similarity: 0.95 }),
    scan({ ground_truth: 'genuine', similarity: 0.8 }),
    scan({ ground_truth: 'impostor', similarity: 0.9 }),
    scan({ ground_truth: 'impostor', similarity: 0.3 }),
    scan({ scan_type: 'identify', ground_truth: 'impostor', similarity: 0.99 }),
    scan({ ground_truth: null, similarity: 0.99 }),
  ];
  it('uses only labelled verify scans', () => {
    expect(verificationTrials(rows)).toHaveLength(4);
  });
  it('computes FAR and FRR at the 1:1 threshold', () => {
    const s = verificationSummary(verificationTrials(rows), 0.88);
    expect(s.far.k).toBe(1);
    expect(s.far.n).toBe(2);
    expect(s.frr.k).toBe(1);
    expect(s.frr.n).toBe(2);
  });
  it('builds ROC points and an EER', () => {
    const roc = rocPoints(verificationTrials(rows));
    expect(roc.length).toBeGreaterThan(10);
    expect(eerFromRoc(roc)).not.toBeNull();
  });
});

describe('1:N identification metrics', () => {
  const trials: IdentificationTrial[] = [
    { mated: true, mateRank: 1, scores: [0.93, 0.7], gallerySize: 100 },
    { mated: true, mateRank: 2, scores: [0.9, 0.88], gallerySize: 100 },
    { mated: true, mateRank: null, scores: [0.6], gallerySize: 100 },
    { mated: false, mateRank: null, scores: [0.86, 0.5], gallerySize: 100 },
    { mated: false, mateRank: null, scores: [0.4], gallerySize: 100 },
  ];
  it('computes FPIR, FNIR and rank rates', () => {
    const s = identificationSummary(trials, 0.85, 5);
    expect(s.fpir.k).toBe(1);
    expect(s.fpir.n).toBe(2);
    expect(s.fnir.k).toBe(1);
    expect(s.rank1.k).toBe(1);
    expect(s.rankK.k).toBe(2);
  });
  it('defines FSR as FPIR', () => {
    expect(falseSelectionRate(trials, 0.85, 5)).toEqual(identificationSummary(trials, 0.85, 5).fpir);
    expect(FSA_DEFINITION.reportedAs).toBe('FPIR');
    expect(FSA_DEFINITION.appliesTo).toMatch(/1:N/);
  });
  it('builds a CMC and projects FPIR with gallery size', () => {
    expect(cmc(trials, 2).map((r) => r.rate)).toEqual([1 / 3, 2 / 3]);
    expect(projectFpir(0.0001, 10000)).toBeCloseTo(1 - Math.exp(-1), 3);
    const projection = galleryProjection(0, 3000, [100, 100000]);
    expect(projection[0].expected).toBe(0);
    expect(projection[1].upper).toBeGreaterThan(projection[0].upper ?? 0);
  });
});

describe('acquisition errors are reported apart from matching errors', () => {
  const event = (over: Partial<AcquisitionEventRow>): AcquisitionEventRow => ({
    id: Math.random().toString(36), created_at: new Date().toISOString(), operation: 'identify', event_type: 'failure_to_acquire', reason_code: 'blur', quality_status: '',
    quality_score: null, frames_attempted: 1, frames_accepted: 0, device_model: '', capture_condition: '', model_version: null, config_version: 1, data_source: 'production', test_session_id: null, ...over,
  });
  it('computes FTA, FTE, service outages and review resolution', () => {
    const rows = [scan({ scan_type: 'identify', frames: 2, outcome: 'uncertain', review_status: 'resolved', review_decision: 'rejected' }), scan({ scan_type: 'enrol_check', frames: 3 })];
    const events = [event({}), event({ event_type: 'service_unavailable' }), event({ operation: 'enrol', event_type: 'failure_to_enrol' })];
    const o = operationalSummary(rows, events);
    expect(o.byOperation.identify.fta.k).toBe(1);
    expect(o.byOperation.identify.fta.n).toBe(3);
    expect(o.serviceOutages).toBe(1);
    expect(o.fte.k).toBe(1);
    expect(o.fte.n).toBe(2);
    expect(o.reviewResolution.rate).toBe(1);
    expect(o.byOperation.identify.uncertain.rate).toBe(1);
  });
});

describe('five-outcome decision workflow', () => {
  it('maps server outcomes and keeps quality / service outside comparisons', () => {
    expect(decisionForOutcome('match')).toBe('MATCH_CONFIRMED');
    expect(decisionForOutcome('uncertain')).toBe('REVIEW_REQUIRED');
    expect(decisionForOutcome('no_match')).toBe('NO_ACCEPTED_MATCH');
    expect(DECISION_COPY.IMAGE_QUALITY_INSUFFICIENT.comparison).toBe(false);
    expect(DECISION_COPY.SERVICE_UNAVAILABLE.comparison).toBe(false);
  });
  it('classifies failures', () => {
    expect(classifyBiometricError(new ServiceUnavailableError('x'))).toBe('service_unavailable');
    expect(classifyBiometricError({ message: 'TypeError: Failed to fetch' })).toBe('service_unavailable');
    expect(classifyBiometricError({ message: 'IMAGE QUALITY INSUFFICIENT: the frame failed' })).toBe('quality');
    expect(classifyBiometricError({ message: 'permission_denied: identify_animal' })).toBe('error');
  });
});

describe('quality pre-check', () => {
  const good: QualityMetrics = { brightness: 130, contrast: 40, sharpness: 200, overexposed: 0.01, fill: 0.3 };
  const detected: MuzzleDetection = { ...EMPTY_DETECTION, muzzleDetected: true, box: [0.2, 0.2, 0.5, 0.5], focus: 'sharp', patternVisible: true };
  it('accepts a good frame', () => {
    expect(assessQuality(detected, good, 1280, 960)).toEqual({ status: GOOD_STATUS, reasons: [] });
  });
  it('reports every specific cause', () => {
    const r = assessQuality({ ...detected, occlusion: 'heavy', lighting: 'glare' }, { ...good, sharpness: 10, overexposed: 0.3 }, 1280, 960);
    expect(r.reasons).toEqual(expect.arrayContaining(['overexposed', 'blur', 'obstructed']));
    expect(assessQuality(detected, good, 320, 240).reasons[0]).toBe('low_resolution');
    expect(assessQuality(EMPTY_DETECTION, null, 1280, 960).status).toBe('MUZZLE NOT DETECTED');
  });
});

describe('threshold governance', () => {
  it('restricts proposal, approval and dashboards to authorised roles', () => {
    expect(canProposeThresholds('Researcher', false)).toBe(true);
    expect(canProposeThresholds('Super Administrator', false)).toBe(false);
    expect(canApproveThresholds('Researcher', false)).toBe(false);
    expect(canApproveThresholds('Super Administrator', true)).toBe(true);
    expect(canOpen('performance', 'Field Worker', defaultPermissions('Field Worker'))).toBe(false);
    expect(canOpen('analytics', 'Farmer', defaultPermissions('Farmer'))).toBe(false);
    expect(canOpen('performance', 'Organisation Administrator', defaultPermissions('Organisation Administrator'))).toBe(true);
  });
  it('validates proposals like the server', () => {
    const base = { verify_accept: '0.9', verify_review: '0.72', identify_accept: '0.87', identify_review: '0.72', identify_margin: '0.03', candidate_list_k: '5', model_version: 'MOOZZLE-TextureHOG-v1', validation_reference: 'BPT-01 batch 2', reason: 'Raise thresholds after lab evaluation' };
    expect(proposalError(base)).toBe('');
    expect(proposalError({ ...base, verify_review: '0.95' })).toMatch(/1:1 review/);
    expect(proposalError({ ...base, validation_reference: '' })).toMatch(/validation/i);
    expect(proposalError({ ...base, reason: 'short' })).toMatch(/reason/i);
  });
});
