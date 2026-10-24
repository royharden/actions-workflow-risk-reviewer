import { expect, it } from 'vitest';
import { combine } from '../../src/core/combine';
import type { CitationResult } from '../../src/core/cited/check';
import { findingsOf, yaml } from './helpers';

it('implements every D10 branch without mutating severity or presence', async () => {
  const findings = await findingsOf(yaml('on: pull_request', 'permissions: read-all', 'jobs:', '  x:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4'));
  const original = findings[0];
  for (const gated of [false, true]) {
    const finding = { ...original, facts: { ...original.facts, gateEvidence: gated ? [{ gate: 'label', line: 1, text: 'label' }] : [] } };
    const before = JSON.stringify(finding);
    expect(combine(finding, false).final).toBe(gated ? 'likely_benign' : 'confirmed');
    expect(combine(finding, true, { supported: false, reason: 'bad citation' }).final).toBe('unsure');
    for (const label of ['confirmed', 'likely_benign', 'unsure'] as const) {
      const answer: CitationResult = { supported: true, output: { triage: label, explanation: 'Example', citations: [{ line: 1, quote: 'on' }] } };
      expect(combine(finding, true, answer).final).toBe(gated && label === 'confirmed' ? 'unsure' : label);
    }
    expect(JSON.stringify(finding)).toBe(before);
    expect(finding.severity).toBe(original.severity);
    expect(findings).toHaveLength(1);
  }
});
