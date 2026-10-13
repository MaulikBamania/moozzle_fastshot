/**
 * Formal definition of "FSA" for MOOZZLE. The abbreviation is never used without this definition.
 *
 * Approved meaning: FSA / FSR = FALSE SELECTION RATE, a 1:N identification metric. It is numerically the
 * False Positive Identification Rate (FPIR) at threshold t and candidate-list length k, so the dashboard
 * reports it as FPIR. It does not apply to 1:1 verification, whose false-acceptance metric is FAR.
 */
import { type IdentificationTrial, identificationSummary } from './identification';
import type { Proportion } from './statistics';

export interface MetricDefinition {
  abbreviation: string;
  name: string;
  status: string;
  appliesTo: string;
  doesNotApplyTo: string;
  definition: string;
  falseSelection: string;
  formula: string;
  numerator: string;
  denominator: string;
  parameters: string[];
  protocol: string[];
  acceptanceThreshold: string;
  distinction: { metric: string; operation: string; question: string; formula: string }[];
  reportedAs: string;
}

export const FSA_DEFINITION: MetricDefinition = {
  abbreviation: 'FSA / FSR',
  name: 'False Selection Rate',
  status: 'Approved project definition — reported on dashboards as FPIR',
  appliesTo: '1:N animal identification (search of the whole enrolled gallery)',
  doesNotApplyTo: '1:1 verification against one claimed MOOZZLE ID — use FAR there',
  definition:
    'The probability that a 1:N biometric search for an animal that is NOT enrolled (a non-mated search) returns one or more candidates whose similarity meets or exceeds the decision threshold within the returned candidate list.',
  falseSelection:
    'A false selection occurs when a non-mated search returns at least one candidate with similarity ≥ t among the top k candidates. Because candidates are ranked by score, this is the same as the rank-1 candidate scoring ≥ t.',
  formula: 'FSR(t, k) = FPIR(t, k) = N_false_selection(t, k) ÷ N_non-mated',
  numerator: 'N_false_selection(t, k): labelled non-mated 1:N searches with ≥ 1 candidate at similarity ≥ t within the top k',
  denominator: 'N_non-mated: all labelled non-mated 1:N searches (searched animal confirmed not enrolled) in the same dataset tier',
  parameters: [
    't = 1:N accept threshold of the configuration under test (review threshold reported separately)',
    'k = candidate-list length of that configuration',
    'N = enrolled gallery size at the time of each search — always reported with the rate',
  ],
  protocol: [
    'Open a controlled test session (laboratory or field pilot, evaluation split) referencing the documented protocol.',
    'Use animals that were never enrolled in the gallery as non-mated probes; capture them with the same validated preprocessing as enrolment.',
    'Exclude failed acquisitions (image quality insufficient) — they are reported as FTA, not as selections.',
    'Label every search mated / non-mated with the true MOOZZLE ID before computing rates.',
    'Report FSR with sample size, 95 % Wilson confidence interval and the gallery size N; with zero false selections report the rule-of-three upper bound 3 ÷ N_non-mated.',
    'Keep calibration and evaluation animals disjoint; an animal in both splits invalidates the evaluation.',
  ],
  acceptanceThreshold: 'No FSR target is approved yet. It must be fixed from 1:N testing at the intended production gallery size and approved with the configuration that uses it.',
  distinction: [
    { metric: 'FAR', operation: '1:1 verification', question: 'Is this animal the claimed MOOZZLE ID?', formula: 'Impostor comparisons accepted ÷ impostor comparisons' },
    { metric: 'FRR', operation: '1:1 verification', question: 'Is a genuine claim wrongly rejected?', formula: 'Genuine comparisons rejected ÷ genuine comparisons' },
    { metric: 'FPIR = FSR', operation: '1:N identification', question: 'Does a search for an unenrolled animal select someone?', formula: 'Non-mated searches with a candidate ≥ t ÷ non-mated searches' },
    { metric: 'FNIR', operation: '1:N identification', question: 'Does a search for an enrolled animal miss it?', formula: 'Mated searches without the true mate ≥ t in top k ÷ mated searches' },
  ],
  reportedAs: 'FPIR',
};

/** FSR(t, k) — identical to FPIR(t, k) by definition. */
export function falseSelectionRate(trials: IdentificationTrial[], threshold: number, k: number): Proportion {
  return identificationSummary(trials, threshold, k).fpir;
}
