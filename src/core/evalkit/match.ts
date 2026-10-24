import type { RuleId } from '../finding';
import { itemId, type ManifestItem } from './manifest';
export interface Prediction {
  id: string; file: string; rule: RuleId; jobId: string | null; stepIndex: number | null;
  span: { startLine: number; endLine: number };
}
export interface MatchPair { prediction: Prediction; item: ManifestItem; itemId: string }
export interface MatchResult { positives: MatchPair[]; benign: MatchPair[]; falsePositives: Prediction[]; falseNegatives: { item: ManifestItem; itemId: string }[] }
export function overlaps(a: Prediction, b: ManifestItem): boolean {
  return a.file === b.file && a.rule === b.rule && a.jobId === b.jobId && a.stepIndex === b.stepIndex &&
    a.span.startLine <= b.span.endLine && b.span.startLine <= a.span.endLine;
}
/** Maximum cardinality bipartite assignment avoids greedy overlap undercounting; every slot is used at most once. */
function assign(predictions: Prediction[], items: { item: ManifestItem; itemId: string }[]): MatchPair[] {
  const itemToPrediction = new Map<number, number>();
  const visit = (predictionIndex: number, seen: Set<number>): boolean => {
    for (let index = 0; index < items.length; index++) {
      if (seen.has(index) || !overlaps(predictions[predictionIndex], items[index].item)) continue;
      seen.add(index);
      const prior = itemToPrediction.get(index);
      if (prior === undefined || visit(prior, seen)) { itemToPrediction.set(index, predictionIndex); return true; }
    }
    return false;
  };
  for (let index = 0; index < predictions.length; index++) visit(index, new Set());
  return [...itemToPrediction].sort(([a], [b]) => a - b).map(([itemIndex, predictionIndex]) => ({ prediction: predictions[predictionIndex], ...items[itemIndex] }));
}
export function match(predictions: Prediction[], labels: ManifestItem[]): MatchResult {
  predictions = predictions.map((prediction) => ({ ...prediction }));
  const indexed = labels.map((item, index) => ({ item, itemId: itemId(item, index) }));
  const positives = assign(predictions, indexed.filter(({ item }) => item.label === 'positive'));
  // Preserve distinct prediction objects: duplicate ids must still count as duplicate false positives.
  const used = new Set(positives.map((pair) => pair.prediction));
  const falsePositives = predictions.filter((prediction) => !used.has(prediction));
  const benign = assign(falsePositives, indexed.filter(({ item }) => item.label !== 'positive'));
  const found = new Set(positives.map((pair) => pair.itemId));
  return { positives, benign, falsePositives, falseNegatives: indexed.filter(({ item, itemId: id }) => item.label === 'positive' && !found.has(id)) };
}
