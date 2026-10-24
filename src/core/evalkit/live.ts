import { z } from 'zod';
import { explainErrorCodeSchema, explainRequestSchema, explainResponseSchema, fitsRequestBounds } from '../cited/schema';
import { hashSchema, sameHashes } from './provenance';
import { splitSchema } from './manifest';
const receiptSchema = z.object({ id: z.string().uuid(), idempotencyKey: z.string(), model: z.string(),
  status: z.enum(['reserved', 'settled', 'failed', 'uncertain']), reserveUsd: z.number().finite().nonnegative(), costUsd: z.number().finite().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  priceVerifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), priceSource: z.enum(['server-response', 'unavailable']),
}).strict();
const attempt = { findingId: z.string().min(1), cacheKey: hashSchema, request: explainRequestSchema };
/** One ordered outcome per finding. A failed dispatch is still a requested model answer (D10). */
export const liveOutcomeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('returned'), ...attempt, response: explainResponseSchema }).strict(),
  z.object({ state: z.literal('attempted_failure'), ...attempt,
    failureKind: z.enum(['function_error', 'deployment_response_mismatch', 'timeout', 'invalid_response', 'network_error']),
    reason: z.string().min(1).max(256) }).strict(),
  z.object({ state: z.literal('context_refused'), findingId: z.string().min(1), reason: z.literal('context_truncated') }).strict(),
  z.object({ state: z.literal('source_unavailable'), findingId: z.string().min(1), reason: z.literal('missing_or_unreviewed_source') }).strict(),
  z.object({ state: z.literal('not_attempted_after_stop'), findingId: z.string().min(1), reason: z.string().min(1).max(256),
    afterFindingId: z.string().min(1) }).strict(),
]);
export type LiveOutcome = z.infer<typeof liveOutcomeSchema>;
export type LiveAttempt = Extract<LiveOutcome, { state: 'returned' | 'attempted_failure' }>;
export type LiveFailure = Extract<LiveOutcome, { state: 'attempted_failure' }>;
export type LiveOmission = Exclude<LiveOutcome, { state: 'returned' }>;

export function wasAttempted(outcome: LiveOutcome): outcome is LiveAttempt {
  return outcome.state === 'returned' || outcome.state === 'attempted_failure';
}
/** Shared by recording and validation: a stop may never silently turn into another attempted request. */
export function stopAfterFailure(outcome: LiveFailure): string | null {
  if (outcome.failureKind === 'function_error') {
    if (['over_budget', 'unauthorized', 'not_configured', 'provider_error', 'unavailable'].includes(outcome.reason)) return `stopped_after_${outcome.reason}`;
    return /^function_status_/.test(outcome.reason) ? 'stopped_after_unknown_outcome' : null;
  }
  return outcome.failureKind === 'deployment_response_mismatch' ? 'stopped_after_deployment_mismatch' : 'stopped_after_unknown_outcome';
}
export const liveCacheSchema = z.object({
  // v1 conflated failures with non-attempts and cannot establish the requested cohort; do not upgrade it by guessing.
  schemaVersion: z.literal(2), source: z.literal('live'), split: splitSchema, runId: z.string().uuid(), capUsd: z.number().finite().positive().max(1),
  createdAt: z.string().datetime(), appVersion: z.string(), ruleVersions: z.record(z.string()), manifestSha256: hashSchema,
  fileHashes: z.record(hashSchema), model: z.string().min(1), promptVersion: z.string().min(1), priceTableSha256: hashSchema,
  priceVerifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), priceSource: z.enum(['server-response', 'local-verified-table-no-response']),
  ledgerComplete: z.boolean(), outcomes: z.array(liveOutcomeSchema), ledgerReceipts: z.array(receiptSchema),
}).strict();
export type LiveCache = z.infer<typeof liveCacheSchema>;
export interface LiveExpected {
  manifestSha256: string; fileHashes: Record<string, string>; appVersion: string; ruleVersions: Record<string, string>;
  model: string; promptVersion: string; priceTableSha256: string; priceVerifiedOn: string; findingIds: string[];
}
export function validateLiveCache(raw: unknown, expected: LiveExpected): LiveCache | null {
  const parsed = liveCacheSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  const returned = value.outcomes.filter((outcome) => outcome.state === 'returned');
  if ((returned.length > 0 && value.priceSource !== 'server-response') || (returned.length === 0 && value.priceSource !== 'local-verified-table-no-response')) return null;
  if (value.manifestSha256 !== expected.manifestSha256 || !sameHashes(value.fileHashes, expected.fileHashes) || value.appVersion !== expected.appVersion ||
    !sameHashes(value.ruleVersions, expected.ruleVersions) || value.model !== expected.model || value.promptVersion !== expected.promptVersion ||
    value.priceTableSha256 !== expected.priceTableSha256 || value.priceVerifiedOn !== expected.priceVerifiedOn || !value.ledgerComplete) return null;
  if (new Set(expected.findingIds).size !== expected.findingIds.length || value.outcomes.length !== expected.findingIds.length ||
    value.outcomes.some((outcome, index) => outcome.findingId !== expected.findingIds[index])) return null;
  const ids = new Set<string>(); const keys = new Set<string>(); const attempts = new Map<string, LiveAttempt>();
  let stopped: { findingId: string; reason: string } | null = null;
  for (const outcome of value.outcomes) {
    if (ids.has(outcome.findingId)) return null;
    ids.add(outcome.findingId);
    if (stopped) {
      if (outcome.state !== 'not_attempted_after_stop' || outcome.afterFindingId !== stopped.findingId || outcome.reason !== stopped.reason) return null;
    } else if (outcome.state === 'not_attempted_after_stop') return null;
    if (!wasAttempted(outcome)) continue;
    if (keys.has(outcome.cacheKey) || attempts.has(outcome.request.idempotencyKey) || outcome.request.runId !== value.runId || !fitsRequestBounds(outcome.request)) return null;
    keys.add(outcome.cacheKey); attempts.set(outcome.request.idempotencyKey, outcome);
    if (outcome.state === 'attempted_failure') {
      if (outcome.failureKind === 'function_error' && !explainErrorCodeSchema.safeParse(outcome.reason).success && !/^function_status_[1-5][0-9]{2}$/.test(outcome.reason)) return null;
      const reason = stopAfterFailure(outcome);
      if (reason) stopped = { findingId: outcome.findingId, reason };
    }
  }
  const receipts = new Map(value.ledgerReceipts.map((receipt) => [receipt.id, receipt]));
  if (receipts.size !== value.ledgerReceipts.length || new Set(value.ledgerReceipts.map((receipt) => receipt.idempotencyKey)).size !== value.ledgerReceipts.length) return null;
  for (const receipt of value.ledgerReceipts) {
    const outcome = attempts.get(receipt.idempotencyKey);
    if (!outcome || receipt.model !== value.model || (receipt.status === 'settled' && (receipt.costUsd === null || receipt.costUsd > receipt.reserveUsd))) return null;
    if (receipt.priceSource === 'server-response') {
      if (outcome.state !== 'returned' || receipt.id !== outcome.response.ledgerId || receipt.priceVerifiedOn !== value.priceVerifiedOn) return null;
    } else if (receipt.priceVerifiedOn !== null) return null;
  }
  for (const entry of returned) {
    if (entry.response.model !== value.model ||
      entry.response.promptVersion !== value.promptVersion || entry.response.priceVerifiedOn !== value.priceVerifiedOn) return null;
    const receipt = receipts.get(entry.response.ledgerId);
    if (!receipt || receipt.status !== 'settled' || receipt.idempotencyKey !== entry.request.idempotencyKey || receipt.priceSource !== 'server-response' ||
      receipt.priceVerifiedOn !== entry.response.priceVerifiedOn ||
      receipt.inputTokens !== entry.response.usage.inputTokens || receipt.outputTokens !== entry.response.usage.outputTokens) return null;
    // The finding-aware cache key is checked against the current finding and excerpt by the eval consumer.
  }
  const total = value.ledgerReceipts.reduce((sum, receipt) => sum + effectiveCharge(receipt), 0);
  if (total > value.capUsd + 0.000001) return null;
  return value;
}
export function effectiveCharge(receipt: LiveCache['ledgerReceipts'][number]): number {
  return receipt.status === 'settled' ? receipt.costUsd ?? receipt.reserveUsd : receipt.reserveUsd;
}
