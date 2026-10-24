import type { TriageLabel } from '../cited/schema';
import type { MatchResult } from './match';
export interface Rate { numerator: number; denominator: number; value: number | null; status: 'measured' | 'not measurable on this set' | 'N/A' }
export function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, value: denominator >= 3 ? numerator / denominator : null,
    status: denominator === 0 ? 'N/A' : denominator < 3 ? 'not measurable on this set' : 'measured' };
}
export interface Metrics { tp: number; fp: number; fn: number; precision: Rate; recall: Rate; f1: number | null; status: string }
export function metrics(result: MatchResult): Metrics {
  const tp = result.positives.length; const fp = result.falsePositives.length; const fn = result.falseNegatives.length;
  const precision = rate(tp, tp + fp); const recall = rate(tp, tp + fn);
  const f1 = precision.value === null || recall.value === null ? null : precision.value + recall.value === 0 ? 0 : 2 * precision.value * recall.value / (precision.value + recall.value);
  return { tp, fp, fn, precision, recall, f1, status: precision.status === 'measured' && recall.status === 'measured' ? 'measured' : 'not measurable on this set' };
}
export interface TriageObservation { predictionId: string; label: TriageLabel }
export interface TriageMetrics {
  benignDemoted: Rate; positivesWronglyDemoted: Rate; benignCandidates: number; positiveCandidates: number;
  cohortPredictionIds: string[]; omittedPredictionIds: string[]; wronglyDemotedItemIds: string[];
}
/** Denominators use the declared observations; requested failures must be observations labelled unsure, never omissions. */
export function triageMetrics(result: MatchResult, observations: TriageObservation[]): TriageMetrics {
  const labels = new Map(observations.map((observation) => [observation.predictionId, observation.label]));
  const benign = result.benign.filter((pair) => pair.item.label === 'lookalike_flagged_benign');
  const observedBenign = benign.filter((pair) => labels.has(pair.prediction.id));
  const observedPositive = result.positives.filter((pair) => labels.has(pair.prediction.id));
  const wrong = observedPositive.filter((pair) => labels.get(pair.prediction.id) === 'likely_benign');
  return {
    benignDemoted: rate(observedBenign.filter((pair) => labels.get(pair.prediction.id) === 'likely_benign').length, observedBenign.length),
    positivesWronglyDemoted: rate(wrong.length, observedPositive.length), benignCandidates: benign.length, positiveCandidates: result.positives.length,
    cohortPredictionIds: [...labels.keys()],
    omittedPredictionIds: [...benign, ...result.positives].filter((pair) => !labels.has(pair.prediction.id)).map((pair) => pair.prediction.id),
    wronglyDemotedItemIds: wrong.map((pair) => pair.itemId),
  };
}
