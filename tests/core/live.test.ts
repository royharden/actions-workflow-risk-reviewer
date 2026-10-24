import { describe, expect, it } from 'vitest';
import ok from '../../fixtures/contracts/ok.json';
import type { ExplainRequest } from '../../src/core/cited/schema';
import type { Finding } from '../../src/core/finding';
import { effectiveCharge, validateLiveCache, type LiveCache, type LiveExpected, type LiveOutcome } from '../../src/core/evalkit/live';
import { match } from '../../src/core/evalkit/match';
import type { ManifestItem } from '../../src/core/evalkit/manifest';
import { triageMetrics } from '../../src/core/evalkit/metrics';
import { pairedLiveTriage } from '../../src/core/evalkit/triage';

const hash = 'a'.repeat(64);
const provenance = { manifestSha256: hash, fileHashes: { 'dev/synthetic.yml': hash }, appVersion: 'synthetic',
  ruleVersions: { 'privileged-trigger-checkout': '1' }, model: 'test-model', promptVersion: ok.expectBody.promptVersion,
  priceTableSha256: hash, priceVerifiedOn: '2026-10-24' };
function finding(id: string, line: number, gated = false): Finding {
  return { id, fingerprint: (line + 10).toString(16).repeat(64), occurrence: id, rule: 'privileged-trigger-checkout', ruleVersion: '1',
    severity: 'critical', file: 'dev/synthetic.yml', fileHash: hash, jobId: 'build', stepKey: '#0', stepIndex: 0,
    span: { startLine: line, endLine: line, startCol: 1, endCol: 1 }, snippet: 'synthetic',
    facts: { triggers: ['pull_request_target'], forkReachable: true, privileged: true, detail: 'Synthetic eval regression',
      gateEvidence: gated ? [{ gate: 'fork-excluding-if', line, text: 'synthetic gate' }] : [] } };
}
function request(item: Finding): ExplainRequest {
  return { ...ok.request, schemaVersion: 1, findingFingerprint: item.fingerprint, ruleId: item.rule,
    facts: { ...item.facts }, idempotencyKey: item.fingerprint };
}
function returned(item: Finding): Extract<LiveOutcome, { state: 'returned' }> {
  return { state: 'returned', findingId: item.id, cacheKey: item.fingerprint, request: request(item), response: { ...ok.expectBody, schemaVersion: 1 } };
}
function failed(item: Finding, failureKind: Extract<LiveOutcome, { state: 'attempted_failure' }>['failureKind'], reason: string): LiveOutcome {
  return { state: 'attempted_failure', findingId: item.id, cacheKey: item.fingerprint, request: request(item), failureKind, reason };
}
function skipped(item: Finding, after: Finding, reason = 'stopped_after_unknown_outcome'): LiveOutcome {
  return { state: 'not_attempted_after_stop', findingId: item.id, reason, afterFindingId: after.id };
}
function expected(findings: Finding[]): LiveExpected { return { ...provenance, findingIds: findings.map((item) => item.id) }; }
function cache(outcomes: LiveOutcome[], ledgerReceipts: LiveCache['ledgerReceipts'] = []): LiveCache {
  return { schemaVersion: 2, source: 'live', split: 'dev', runId: ok.request.runId, capUsd: 1,
    createdAt: '2026-10-24T12:00:00Z', ...provenance, priceSource: outcomes.some((outcome) => outcome.state === 'returned') ? 'server-response' : 'local-verified-table-no-response',
    ledgerComplete: true, outcomes, ledgerReceipts };
}
function label(item: Finding, kind: ManifestItem['label']): ManifestItem {
  return { file: item.file, split: 'dev', rule: item.rule, jobId: item.jobId, stepIndex: item.stepIndex,
    span: { startLine: item.span.startLine, endLine: item.span.endLine }, label: kind, trap: 'synthetic-live-cohort', gate: null, note: '' };
}
function receipt(item: Finding, status: LiveCache['ledgerReceipts'][number]['status'] = 'uncertain'): LiveCache['ledgerReceipts'][number] {
  return { id: status === 'settled' ? ok.expectBody.ledgerId : '44444444-4444-4444-8444-444444444444', idempotencyKey: item.fingerprint,
    model: provenance.model, status, reserveUsd: 0.01, costUsd: status === 'settled' ? 0.001 : null,
    inputTokens: status === 'settled' ? 100 : null, outputTokens: status === 'settled' ? 40 : null,
    priceVerifiedOn: status === 'settled' ? provenance.priceVerifiedOn : null, priceSource: status === 'settled' ? 'server-response' : 'unavailable' };
}

describe('attempted live failures remain in the paired D10 cohort', () => {
  // Regression: a gated timeout used to disappear, changing the paired denominator to returned-success survivors.
  it('keeps a gate-bearing timeout as model/final unsure beside successful answers, excluding the later non-attempt only', () => {
    const earlier = finding('returned-benign', 1); const timedOut = finding('gated-timeout-positive', 2, true); const later = finding('later-benign', 3);
    const findings = [earlier, timedOut, later];
    const value = cache([returned(earlier), failed(timedOut, 'timeout', 'timeout_no_retry'), skipped(later, timedOut)], [receipt(earlier, 'settled'), receipt(timedOut)]);
    expect(validateLiveCache(value, expected(findings))).not.toBe(null);
    const paired = pairedLiveTriage(findings, value.outcomes);
    expect(paired.cohortPredictionIds).toEqual([earlier.id, timedOut.id]);
    expect(paired.gatesOnly).toEqual([{ predictionId: earlier.id, label: 'confirmed' }, { predictionId: timedOut.id, label: 'likely_benign' }]);
    expect(paired.modelOnly).toEqual([{ predictionId: earlier.id, label: 'confirmed' }, { predictionId: timedOut.id, label: 'unsure' }]);
    expect(paired.final).toEqual(paired.modelOnly);
    const matched = match(findings, [label(earlier, 'lookalike_flagged_benign'), label(timedOut, 'positive'), label(later, 'lookalike_flagged_benign')]);
    const rows = [paired.gatesOnly, paired.modelOnly, paired.final].map((observations) => triageMetrics(matched, observations));
    for (const row of rows) {
      expect(row.cohortPredictionIds).toEqual([earlier.id, timedOut.id]);
      expect([row.benignDemoted.denominator, row.positivesWronglyDemoted.denominator]).toEqual([1, 1]);
      expect(row.omittedPredictionIds).toEqual([later.id]);
    }
    expect(rows.map((row) => row.positivesWronglyDemoted.numerator)).toEqual([1, 0, 0]);
    expect(paired.omissions.map((outcome) => outcome.state)).toEqual(['attempted_failure', 'not_attempted_after_stop']);
    expect(paired.supported).toBe(1); expect(paired.unsupported).toBe(0);
    expect(value.ledgerReceipts.reduce((sum, row) => sum + effectiveCharge(row), 0)).toBeCloseTo(0.011);
  });

  // Regression: a malformed function response used to be an omission instead of an unsure observation.
  it('retains an invalid function response in all paired rows even when no successful answer was returned', () => {
    const invalid = finding('invalid-function-benign', 1, true); const later = finding('later-positive', 2);
    const findings = [invalid, later];
    // A provider may have settled even though the function response could not be parsed; retain that actual charge without inventing its price date.
    const charged = { ...receipt(invalid, 'settled'), priceVerifiedOn: null, priceSource: 'unavailable' as const };
    const value = cache([failed(invalid, 'invalid_response', 'invalid_function_response'), skipped(later, invalid)], [charged]);
    expect(validateLiveCache(value, expected(findings))).not.toBe(null);
    const paired = pairedLiveTriage(findings, value.outcomes);
    const matched = match(findings, [label(invalid, 'lookalike_flagged_benign'), label(later, 'positive')]);
    const rows = [paired.gatesOnly, paired.modelOnly, paired.final].map((observations) => triageMetrics(matched, observations));
    expect(paired.gatesOnly).toEqual([{ predictionId: invalid.id, label: 'likely_benign' }]);
    expect(paired.modelOnly).toEqual([{ predictionId: invalid.id, label: 'unsure' }]); expect(paired.final).toEqual(paired.modelOnly);
    for (const row of rows) {
      expect(row.cohortPredictionIds).toEqual([invalid.id]);
      expect([row.benignDemoted.denominator, row.positivesWronglyDemoted.denominator]).toEqual([1, 0]);
      expect(row.omittedPredictionIds).toEqual([later.id]);
    }
    expect(rows.map((row) => row.benignDemoted.numerator)).toEqual([1, 0, 0]);
    expect(paired.supported).toBe(0); expect(paired.unsupported).toBe(0); expect(effectiveCharge(charged)).toBe(0.001);
  });

  it('distinguishes context refusal and unavailable source from a requested budget refusal and later stop', () => {
    const context = finding('context-refused', 1); const source = finding('source-unavailable', 2);
    const budget = finding('budget-refused-positive', 3, true); const later = finding('later-not-sent', 4);
    const findings = [context, source, budget, later];
    const value = cache([{ state: 'context_refused', findingId: context.id, reason: 'context_truncated' },
      { state: 'source_unavailable', findingId: source.id, reason: 'missing_or_unreviewed_source' },
      failed(budget, 'function_error', 'over_budget'), skipped(later, budget, 'stopped_after_over_budget')]);
    expect(validateLiveCache(value, expected(findings))).not.toBe(null);
    const paired = pairedLiveTriage(findings, value.outcomes);
    const matched = match(findings, findings.map((item) => label(item, 'positive')));
    for (const observations of [paired.gatesOnly, paired.modelOnly, paired.final]) {
      const row = triageMetrics(matched, observations);
      expect(row.cohortPredictionIds).toEqual([budget.id]); expect(row.positivesWronglyDemoted.denominator).toBe(1);
      expect(row.benignDemoted.denominator).toBe(0); expect(row.omittedPredictionIds).toEqual([context.id, source.id, later.id]);
    }
    expect(paired.modelOnly).toEqual([{ predictionId: budget.id, label: 'unsure' }]); expect(paired.final).toEqual(paired.modelOnly);
    expect(paired.omissions.map((outcome) => outcome.state)).toEqual(['context_refused', 'source_unavailable', 'attempted_failure', 'not_attempted_after_stop']);
    expect(value.ledgerReceipts).toEqual([]); // Budget refusal occurred before reservation; no charge is fabricated.
  });

  it('rejects missing/duplicate outcomes, wrong request run, forged stop states, receipts for non-attempts and ambiguous old caches', () => {
    const timedOut = finding('timeout', 1, true); const later = finding('later-not-sent', 2);
    const findings = [timedOut, later]; const failure = failed(timedOut, 'timeout', 'timeout_no_retry');
    const value = cache([failure, skipped(later, timedOut)], [receipt(timedOut)]);
    expect(validateLiveCache(value, expected(findings))).not.toBe(null);
    for (const outcomes of [[failure], [failure, failure], [skipped(timedOut, later), skipped(later, timedOut)],
      [failure, { ...skipped(later, timedOut), afterFindingId: later.id }],
      [failure, { ...skipped(later, timedOut), reason: 'stopped_after_over_budget' }],
      [failure, returned(later)],
      [{ ...failure, request: { ...request(timedOut), runId: '99999999-9999-4999-8999-999999999999' } }, skipped(later, timedOut)]])
      expect(validateLiveCache({ ...value, outcomes }, expected(findings))).toBe(null);
    expect(validateLiveCache({ ...value, schemaVersion: 1 }, expected(findings))).toBe(null);
    expect(validateLiveCache({ ...value, ledgerReceipts: [receipt(later)] }, expected(findings))).toBe(null);
    expect(validateLiveCache({ ...value, ledgerReceipts: [receipt(timedOut, 'settled')] }, expected(findings))).toBe(null);
    expect(validateLiveCache({ ...value, ledgerComplete: false }, expected(findings))).toBe(null);
    expect(validateLiveCache(value, expected([later, timedOut]))).toBe(null);
    expect(() => pairedLiveTriage(findings, [failure])).toThrow('scope/order');
  });
});
