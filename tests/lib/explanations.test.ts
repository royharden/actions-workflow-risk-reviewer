import { describe, expect, it } from 'vitest';
import { createExplanationSession, type ExplanationInput } from '../../src/lib/explanations';
import type { ExplainRequest } from '../../src/lib/providers/contract';
import type { ExplainProvider, ProviderResult } from '../../src/lib/providers';
import { nodeHasher, scanOne } from '../core/helpers';

const RUN_A = '00000000-0000-4000-8000-000000000025';
const RUN_B = '00000000-0000-4000-8000-000000000026';
const USER_A = 'owner-a';
const USER_B = 'owner-b';
const sourceText = 'on: push\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n';

async function input(text = sourceText): Promise<ExplanationInput> {
  const file = await scanOne(text);
  const finding = file.findings.find((candidate) => candidate.rule === 'unpinned-uses');
  if (!finding) throw new Error('fixture must have an unpinned finding');
  return { finding, source: { name: file.name, text }, userId: USER_A, runId: RUN_A, consented: true };
}

function response(request: ExplainRequest, origin: 'live' | 'hand-written' = 'live', rawText?: string): ProviderResult {
  const citation = request.excerptLines.find((line) => line.text.includes('actions/checkout@v4'));
  if (!citation) throw new Error('fixture excerpt must include checkout');
  return {
    ok: true, source: origin,
    response: {
      schemaVersion: 1, promptVersion: 'test-prompt/1', model: 'test-model', priceVerifiedOn: '2026-10-24',
      rawText: rawText ?? JSON.stringify({ triage: 'confirmed', explanation: 'Synthetic source-bound test answer.', citations: [{ line: citation.line, quote: 'actions/checkout@v4' }] }),
      usage: { inputTokens: 0, outputTokens: 0 }, ledgerId: RUN_A,
    },
  };
}

describe('browser explanation orchestration (synthetic providers; no real model calls)', () => {
  it('requires the current user, consent and an owned run before making a live call', async () => {
    const finding = await input();
    let calls = 0;
    const session = createExplanationSession({ mode: { kind: 'live' }, hasher: nodeHasher, liveProviderForUser: () => ({ async explain(request) { calls += 1; return response(request); } }) });
    expect((await session.explain(finding)).status).toBe('unsupported');
    session.setUser(USER_A);
    expect(await session.explain({ ...finding, consented: false })).toMatchObject({ status: 'unsupported', reason: 'consent_required' });
    expect(await session.explain({ ...finding, runId: null })).toMatchObject({ status: 'unsupported', reason: 'owned_run_required' });
    expect(calls).toBe(0);
    expect(await session.explain(finding)).toMatchObject({ status: 'supported', origin: 'live', priceVerifiedOn: '2026-10-24' });
    expect(calls).toBe(1);
  });

  it('returns unsure and hides invalid free-form output even when a gate demotes', async () => {
    const finding = await input();
    finding.finding = { ...finding.finding, facts: { ...finding.finding.facts, gateEvidence: [{ gate: 'test-gate', line: 1, text: 'test-only' }] } };
    const session = createExplanationSession({ mode: { kind: 'demo', reason: 'explicit' }, hasher: nodeHasher, exampleProviderForFinding: () => ({ async explain(request) { return response(request, 'hand-written', JSON.stringify({ triage: 'likely_benign', explanation: 'MUST BE HIDDEN', citations: [], severity: 'low' })); } }) });
    const outcome = await session.explain({ ...finding, userId: null, runId: null });
    expect(outcome).toMatchObject({ status: 'unsupported', origin: 'hand-written', triage: { gatesOnly: 'likely_benign', final: 'unsure', source: 'unsupported' } });
    expect(JSON.stringify(outcome)).not.toContain('MUST BE HIDDEN');
    // Regrouping mounts a fresh card; its read-only replay must retain the unsupported/unsure ruling.
    expect(session.peek({ finding: finding.finding, userId: null, runId: null })).toEqual(outcome);
    expect(finding.finding.severity).toBe('medium');
  });

  it('makes no provider call for changed source, over-60-line context, or an over-16KiB request', async () => {
    let calls = 0;
    const provider: ExplainProvider = { async explain(request) { calls += 1; return response(request, 'hand-written'); } };
    const session = createExplanationSession({ mode: { kind: 'demo', reason: 'explicit' }, hasher: nodeHasher, exampleProviderForFinding: () => provider });
    const original = await input();
    expect(await session.explain({ ...original, userId: null, source: { ...original.source, text: `${sourceText}# edited\n` } })).toMatchObject({ status: 'unsupported', reason: 'source_changed' });
    for (const text of [`${sourceText}${'      - run: echo more\n'.repeat(65)}`, `${sourceText}      - run: echo ${'x'.repeat(17000)}\n`]) {
      const oversized = await input(text);
      expect(await session.explain({ ...oversized, userId: null })).toMatchObject({ status: 'unsupported', reason: 'context_truncated', triage: { final: 'unsure' } });
    }
    expect(calls).toBe(0);
  });

  it('replays one attempt in memory and never substitutes an example for a failed live call', async () => {
    let liveCalls = 0, exampleCalls = 0;
    const session = createExplanationSession({
      mode: { kind: 'live' }, hasher: nodeHasher,
      liveProviderForUser: () => ({ async explain() { liveCalls += 1; return { ok: false, reason: 'over_budget' }; } }),
      exampleProviderForFinding: () => ({ async explain(request) { exampleCalls += 1; return response(request, 'hand-written'); } }),
    });
    session.setUser(USER_A);
    const finding = await input();
    expect(await session.explain(finding)).toMatchObject({ status: 'unsupported', origin: 'live', reason: 'over_budget' });
    expect(await session.explain(finding)).toMatchObject({ status: 'unsupported', reason: 'over_budget' });
    expect(liveCalls).toBe(1); expect(exampleCalls).toBe(0);
    session.setUser(USER_B);
    expect(session.peek({ finding: finding.finding, userId: USER_A, runId: RUN_A })).toBeNull();
  });

  it('serializes separate finding attempts and rejects an old-account result after a switch', async () => {
    let calls = 0;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const session = createExplanationSession({ mode: { kind: 'live' }, hasher: nodeHasher, liveProviderForUser: () => ({ async explain(request) {
      calls += 1;
      if (calls === 1) { entered(); await pending; }
      return response(request);
    } }) });
    session.setUser(USER_A);
    const finding = await input();
    const first = session.explain(finding);
    await started;
    const queuedOldAccount = session.explain({ ...finding, runId: RUN_B });
    session.setUser(USER_B);
    const currentAccount = session.explain({ ...finding, userId: USER_B, runId: RUN_B });
    expect(calls).toBe(1);
    release();
    expect(await first).toMatchObject({ status: 'unsupported', reason: 'session_changed' });
    expect(await queuedOldAccount).toMatchObject({ status: 'unsupported', reason: 'session_changed' });
    expect(await currentAccount).toMatchObject({ status: 'supported', origin: 'live' });
    expect(calls).toBe(2);
  });

  it('rejects wrong-origin responses and never initializes a live provider for demo mode', async () => {
    let liveProviders = 0;
    const session = createExplanationSession({
      mode: { kind: 'demo', reason: 'explicit' }, hasher: nodeHasher,
      liveProviderForUser: () => { liveProviders += 1; throw new Error('must stay offline'); },
      exampleProviderForFinding: () => ({ async explain(request) { return response(request, 'live'); } }),
    });
    expect(await session.explain({ ...await input(), userId: null, runId: null })).toMatchObject({ status: 'unsupported', reason: 'provider_origin_mismatch' });
    expect(liveProviders).toBe(0);
  });
});
