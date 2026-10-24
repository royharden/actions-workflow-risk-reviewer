import { describe, expect, it } from 'vitest';
import zizmorSample from '../../fixtures/baselines/samples/zizmor.format.json';
import poutineSample from '../../fixtures/baselines/samples/poutine.format.json';
import mappingRaw from '../../fixtures/baselines/rules_mapping.json';
import ok from '../../fixtures/contracts/ok.json';
import { adaptZizmor } from '../../src/core/evalkit/adapters/zizmor';
import { adaptPoutine } from '../../src/core/evalkit/adapters/poutine';
import { mappingSchema } from '../../src/core/evalkit/adapters/types';
import { validateBaseline, type BaselineExpected } from '../../src/core/evalkit/provenance';
import { effectiveCharge, liveCacheSchema, validateLiveCache } from '../../src/core/evalkit/live';
import { hasherNode } from '../../scripts/hasher-node';
const mapping = mappingSchema.parse(mappingRaw);
describe('provisional baseline adapters (format examples, not measurements)', () => {
  it('adapts one primary location per zizmor finding with zero-based row conversion', () => {
    expect(zizmorSample.source).toBe('hand-written-format-sample');
    const result = adaptZizmor(zizmorSample.output, mapping);
    expect(result.predictions).toEqual([{ id: 'zizmor:0', file: 'dev/example.yml', rule: 'unpinned-uses', jobId: 'build', stepIndex: 0, span: { startLine: 10, endLine: 10 } }]);
    expect(result.unmapped).toHaveLength(1);
  });
  it('adapts assumed poutine locations and keeps unknown IDs explicitly unmapped', () => {
    const result = adaptPoutine(poutineSample.output, mapping);
    expect(result.predictions[0]).toMatchObject({ file: 'dev/example.yml', rule: 'unpinned-uses', jobId: 'build', stepIndex: 0, span: { startLine: 10, endLine: 10 } });
    expect(result.unmapped).toEqual([{ toolRule: 'unknown-example-rule', file: 'dev/example.yml' }]);
  });
  it('rejects unsupported native shapes, missing identities, traversal and absolute paths', () => {
    expect(() => adaptZizmor({ madeUp: true }, mapping)).toThrow();
    expect(() => adaptPoutine({ findings: [{ rule_id: 'unpinned-action', file: '/tmp/example.yml', start_line: 1, end_line: 1, job_id: null, step_index: null }] }, mapping)).toThrow();
    expect(() => adaptPoutine({ findings: [{ rule_id: 'unpinned-action', file: 'dev/../heldout/example.yml', start_line: 1, end_line: 1, job_id: null, step_index: null }] }, mapping)).toThrow();
    expect(() => adaptPoutine({ findings: [{ rule_id: 'unpinned-action', file: 'dev/example.yml', start_line: 1, end_line: 1 }] }, mapping)).toThrow();
  });
  it('requires real-output provenance and exact config/hash/split/scope matches', async () => {
    const output = '[]'; const digest = 'a'.repeat(64);
    const expected: BaselineExpected = { split: 'dev', fileHashes: { 'dev/example.yml': digest }, manifestSha256: digest, mappingSha256: digest,
      config: { tool: 'zizmor', version: 'synthetic-test-version', persona: 'regular', minSeverity: 'low', flags: ['synthetic-test-flag'], formatVerified: true } };
    const receipt = { schemaVersion: 1, source: 'recorded-tool-output', split: 'dev', outputFile: 'zizmor/dev.json', outputSha256: await hasherNode.sha256Hex(output),
      fileHashes: expected.fileHashes, manifestSha256: digest, mappingSha256: digest, config: expected.config, recordedAt: '2026-10-24T12:00:00Z' };
    expect(await validateBaseline(receipt, output, expected, hasherNode)).not.toBe(null);
    for (const changed of [{ source: 'hand-written-format-sample' }, { split: 'heldout' }, { fileHashes: {} }, { manifestSha256: 'b'.repeat(64) },
      { mappingSha256: 'b'.repeat(64) }, { config: { ...expected.config, persona: 'pedantic' } }, { outputSha256: 'b'.repeat(64) }])
      expect(await validateBaseline({ ...receipt, ...changed }, output, expected, hasherNode)).toBe(null);
    expect(await validateBaseline(receipt, '[{}]', expected, hasherNode)).toBe(null);
    expect(await validateBaseline({ ...receipt, config: { ...expected.config, formatVerified: false } }, output, expected, hasherNode)).toBe(null);
  });
  it('cannot interpret hand-written model examples as a cached live run', () => {
    expect(liveCacheSchema.safeParse({ source: 'hand-written', entries: [] }).success).toBe(false);
  });
  it('binds cached live provenance to ledger IDs, actual model, usage and server price dates', () => {
    const hash = 'a'.repeat(64);
    const provenance = { manifestSha256: hash, fileHashes: { 'dev/example.yml': hash }, appVersion: 'synthetic', ruleVersions: { 'unpinned-uses': '1' },
      model: 'test-model', promptVersion: ok.expectBody.promptVersion, priceTableSha256: hash, priceVerifiedOn: '2026-10-24' };
    const expected = { ...provenance, findingIds: ['synthetic-finding'] };
    const cache = { schemaVersion: 2, source: 'live', split: 'dev', runId: ok.request.runId, capUsd: 1, createdAt: '2026-10-24T12:00:00Z', ...provenance,
      priceSource: 'server-response', ledgerComplete: true, outcomes: [{ state: 'returned', findingId: 'synthetic-finding', cacheKey: hash, request: ok.request, response: ok.expectBody }],
      ledgerReceipts: [{ id: ok.expectBody.ledgerId, idempotencyKey: ok.request.idempotencyKey, model: 'test-model', status: 'settled', reserveUsd: 0.01,
        costUsd: 0.001, inputTokens: 100, outputTokens: 40, priceVerifiedOn: '2026-10-24', priceSource: 'server-response' }] };
    expect(validateLiveCache(cache, expected)).not.toBe(null);
    for (const changed of [{ ledgerComplete: false }, { fileHashes: {} }, { appVersion: 'changed' }, { ruleVersions: {} }, { priceTableSha256: 'b'.repeat(64) },
      { ledgerReceipts: [{ ...cache.ledgerReceipts[0], model: 'different-model' }] }, { ledgerReceipts: [{ ...cache.ledgerReceipts[0], inputTokens: 999 }] },
      { ledgerReceipts: [{ ...cache.ledgerReceipts[0], priceVerifiedOn: '2026-10-23' }] }, { ledgerReceipts: [{ ...cache.ledgerReceipts[0], id: ok.request.runId }] },
      { outcomes: [cache.outcomes[0], cache.outcomes[0]] }, { schemaVersion: 1 }]) expect(validateLiveCache({ ...cache, ...changed }, expected)).toBe(null);
    const receipt = liveCacheSchema.parse(cache).ledgerReceipts[0];
    expect(effectiveCharge(receipt)).toBe(0.001);
    for (const status of ['reserved', 'failed', 'uncertain'] as const) expect(effectiveCharge({ ...receipt, status })).toBe(0.01);
  });
});
