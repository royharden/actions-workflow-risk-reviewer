import { describe, expect, it } from 'vitest';
import { metrics, rate, triageMetrics } from '../../src/core/evalkit/metrics';
import { match, type Prediction } from '../../src/core/evalkit/match';
import type { ManifestItem } from '../../src/core/evalkit/manifest';
const label = (line: number, kind: ManifestItem['label'] = 'positive'): ManifestItem => ({ file: 'dev/example.yml', split: 'dev',
  rule: 'unpinned-uses', jobId: 'build', stepIndex: 0, span: { startLine: line, endLine: line }, label: kind, trap: 'synthetic', gate: null, note: '' });
const prediction = (line: number): Prediction => ({ ...label(line), id: String(line) });
describe('metrics with visible denominators', () => {
  it('prints zero as N/A, n=1/2 as not measurable, and n=3 as a rate', () => {
    expect(rate(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null, status: 'N/A' });
    for (const n of [1, 2]) expect(rate(1, n)).toMatchObject({ value: null, status: 'not measurable on this set' });
    expect(rate(1, 3)).toMatchObject({ value: 1 / 3, status: 'measured' });
  });
  it('counts TP/FP/FN without pooling rules or requiring any TN estimate', () => {
    const result = metrics(match([prediction(1), prediction(2), prediction(9)], [label(1), label(2), label(3)]));
    expect(result).toMatchObject({ tp: 2, fp: 1, fn: 1 });
    expect(result.precision.value).toBe(2 / 3); expect(result.recall.value).toBe(2 / 3); expect(result.f1).toBeCloseTo(2 / 3);
  });
  it('uses flagged-benign candidates only for k/n and positives for j/m; omissions stay visible', () => {
    const result = match([prediction(1), prediction(2), prediction(3), prediction(4)], [label(1), label(2, 'lookalike_flagged_benign'), label(3, 'lookalike_excluded'), label(4, 'lookalike_flagged_benign')]);
    const triage = triageMetrics(result, [{ predictionId: '1', label: 'likely_benign' }, { predictionId: '2', label: 'likely_benign' }, { predictionId: '3', label: 'likely_benign' }]);
    expect(triage.benignDemoted).toMatchObject({ numerator: 1, denominator: 1 });
    expect(triage.positivesWronglyDemoted).toMatchObject({ numerator: 1, denominator: 1 });
    expect(triage.benignCandidates).toBe(2); expect(triage.omittedPredictionIds).toEqual(['4']); expect(triage.wronglyDemotedItemIds).toHaveLength(1);
  });
  it('unsupported requested outputs represented as unsure do not count as a demotion', () => {
    const triage = triageMetrics(match([prediction(1)], [label(1)]), [{ predictionId: '1', label: 'unsure' }]);
    expect(triage.positivesWronglyDemoted).toMatchObject({ numerator: 0, denominator: 1 });
  });
});
