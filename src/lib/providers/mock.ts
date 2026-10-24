import examples from '../../../fixtures/model-cache.json';
import type { Finding } from '../../core/finding';
import type { Hasher } from '../../core/hash';
import { explanationCacheKey } from '../../core/cited/prompt';
import type { ExplainRequest } from './contract';
import type { ExplainProvider, ProviderResult } from './index';

/** Immutable hand-written fixture examples, never measurements or fallback live answers. */
export function mockProvider(finding: Finding, hasher: Hasher): ExplainProvider {
  const cache = new Map<string, ProviderResult>();
  return { async explain(request: ExplainRequest): Promise<ProviderResult> {
    const example = examples.entries.find((entry) => entry.file === finding.file && entry.fileHash === finding.fileHash &&
      entry.rule === finding.rule && entry.startLine === finding.span.startLine && entry.ruleVersion === finding.ruleVersion);
    if (!example || request.findingFingerprint !== finding.fingerprint) return { ok: false, reason: 'no_handwritten_example_for_this_finding' };
    const key = await explanationCacheKey(finding, request, example.promptVersion, 'mock', example.model, hasher);
    const cached = cache.get(key);
    if (cached) return cached;
    const value: ProviderResult = { ok: true, source: 'hand-written', cacheKey: key, response: {
      // Simulated date for hand-written examples, never a live price verification claim.
      schemaVersion: 1, promptVersion: example.promptVersion, model: example.model, priceVerifiedOn: '2026-10-24', rawText: example.rawText,
      usage: { inputTokens: 0, outputTokens: 0 }, ledgerId: '00000000-0000-4000-8000-000000000025',
    } };
    cache.set(key, value);
    return value;
  } };
}
