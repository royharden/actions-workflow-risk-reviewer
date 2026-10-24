import { describe, expect, it } from 'vitest';
import { match, type Prediction } from '../../src/core/evalkit/match';
import type { ManifestItem } from '../../src/core/evalkit/manifest';
function label(startLine: number, endLine = startLine, kind: ManifestItem['label'] = 'positive'): ManifestItem {
  return { file: 'dev/example.yml', split: 'dev', rule: 'unpinned-uses', jobId: 'build', stepIndex: 0,
    span: { startLine, endLine }, label: kind, trap: 'synthetic', gate: null, note: '' };
}
function prediction(id: string, startLine: number, endLine = startLine): Prediction {
  return { id, file: 'dev/example.yml', rule: 'unpinned-uses', jobId: 'build', stepIndex: 0, span: { startLine, endLine } };
}
describe('one-to-one label matching', () => {
  it('matches maximum cardinality rather than a greedy overlap', () => {
    // Broad first prediction overlaps both labels; narrow second can match only the first.
    const result = match([prediction('broad', 1, 3), prediction('narrow', 1)], [label(1), label(3)]);
    expect(result.positives).toHaveLength(2); expect(result.falseNegatives).toHaveLength(0); expect(result.falsePositives).toHaveLength(0);
  });
  it('counts duplicate predictions as FP, even repeated references and ids', () => {
    const repeated = prediction('same', 1);
    const result = match([repeated, repeated], [label(1)]);
    expect(result.positives).toHaveLength(1); expect(result.falsePositives).toHaveLength(1);
  });
  it('treats both look-alike labels as benign for detection precision', () => {
    const result = match([prediction('excluded', 1), prediction('flagged', 3)], [label(1, 1, 'lookalike_excluded'), label(3, 3, 'lookalike_flagged_benign')]);
    expect(result.positives).toHaveLength(0); expect(result.falsePositives).toHaveLength(2); expect(result.benign).toHaveLength(2);
  });
  it('requires exact file, rule, job and step index, with overlapping spans', () => {
    const base = prediction('one', 1);
    for (const changed of [{ file: 'heldout/example.yml' }, { rule: 'secrets-exposure' as const }, { jobId: 'other' }, { stepIndex: 1 }, { span: { startLine: 2, endLine: 2 } }]) {
      expect(match([{ ...base, ...changed }], [label(1)]).positives).toHaveLength(0);
    }
    const workflow = { ...base, jobId: null, stepIndex: null };
    expect(match([workflow], [{ ...label(1), jobId: null, stepIndex: null }]).positives).toHaveLength(1);
  });
  it('does not match one prediction to multiple positive labels', () => {
    const result = match([prediction('one', 1, 3)], [label(1), label(3)]);
    expect(result.positives).toHaveLength(1); expect(result.falseNegatives).toHaveLength(1);
  });
});
