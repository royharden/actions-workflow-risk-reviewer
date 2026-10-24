// Explicitly invoked by eval --live only. This is the only eval spend path; all model requests use explain-finding.
import { createClient } from '@supabase/supabase-js';
import { buildExplainRequest, explanationCacheKey } from '../src/core/cited/prompt';
import { explainErrorSchema, explainResponseSchema } from '../src/core/cited/schema';
import type { Finding } from '../src/core/finding';
import { parseWorkflow } from '../src/core/parse';
import type { Split } from '../src/core/evalkit/manifest';
import { stopAfterFailure, type LiveCache, type LiveFailure } from '../src/core/evalkit/live';
import { canonicalJson } from '../src/core/evalkit/provenance';
import { PRICES, lookupVerifiedPrice } from '../supabase/functions/explain-finding/pricing';
import { PROMPT_VERSION } from '../supabase/functions/explain-finding/prompt';
import { hasherNode } from './hasher-node';

export interface LiveInput {
  split: Split; findings: Finding[]; sources: Map<string, string>; manifestSha256: string; fileHashes: Record<string, string>;
  appVersion: string; ruleVersions: Record<string, string>; capUsd: number;
}
export async function runLive(input: LiveInput): Promise<LiveCache> {
  const jwt = process.env.EVAL_USER_JWT;
  const url = process.env.VITE_SUPABASE_URL; const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const model = process.env.EVAL_MODEL;
  const price = model ? lookupVerifiedPrice(PRICES, model) : null;
  const priceTableSha256 = await hasherNode.sha256Hex(canonicalJson(PRICES));
  // Operator attests that the deployed function contains this exact verified table and prompt.
  // The date itself is obtained from each server success and paired to the actual ledger row by id.
  if (!jwt || !url || !anonKey || !model || !price || !Number.isFinite(input.capUsd) || input.capUsd <= 0 || input.capUsd > 1 ||
    process.env.EVAL_DEPLOYED_PRICE_TABLE_SHA256 !== priceTableSha256 || process.env.EVAL_DEPLOYED_PROMPT_VERSION !== PROMPT_VERSION)
    throw new Error('Live eval configuration/verified deployment price attestation missing; no calls made.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:') throw new Error('Live eval requires an HTTPS deployment.');
  if (price.verifiedOn > new Date().toISOString().slice(0, 10)) throw new Error('Future price verification date.');
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const identity = await client.auth.getUser(jwt);
  if (identity.error || !identity.data.user) throw new Error('Eval JWT was not authenticated.');
  const created = await client.from('runs').insert({ owner: identity.data.user.id, kind: 'eval', cap_usd: input.capUsd,
    app_version: input.appVersion, rule_versions: input.ruleVersions, file_hashes: Object.values(input.fileHashes) }).select('id').single();
  if (created.error || !created.data) throw new Error('Could not create capped eval run.');
  const cache: LiveCache = { schemaVersion: 2, source: 'live', split: input.split, runId: created.data.id, capUsd: input.capUsd,
    createdAt: new Date().toISOString(), appVersion: input.appVersion, ruleVersions: input.ruleVersions, manifestSha256: input.manifestSha256,
    fileHashes: input.fileHashes, model, promptVersion: PROMPT_VERSION, priceTableSha256, priceVerifiedOn: price.verifiedOn,
    priceSource: 'local-verified-table-no-response', ledgerComplete: true, outcomes: [], ledgerReceipts: [] };
  let stopped: { findingId: string; reason: string } | null = null;
  for (const finding of input.findings) {
    if (stopped) { cache.outcomes.push({ state: 'not_attempted_after_stop', findingId: finding.id, reason: stopped.reason, afterFindingId: stopped.findingId }); continue; }
    const source = input.sources.get(finding.file);
    const parsed = source === undefined ? null : parseWorkflow(source);
    if (!parsed?.ok) { cache.outcomes.push({ state: 'source_unavailable', findingId: finding.id, reason: 'missing_or_unreviewed_source' }); continue; }
    const built = await buildExplainRequest(parsed, finding, cache.runId, hasherNode);
    if (!built.ok) { cache.outcomes.push({ state: 'context_refused', findingId: finding.id, reason: built.reason }); continue; }
    const attempt = { findingId: finding.id, request: built.request,
      cacheKey: await explanationCacheKey(finding, built.request, PROMPT_VERSION, 'function', model, hasherNode) };
    const recordFailure = (failureKind: LiveFailure['failureKind'], reason: string): { findingId: string; reason: string } | null => {
      const outcome: LiveFailure = { state: 'attempted_failure', ...attempt, failureKind, reason };
      cache.outcomes.push(outcome);
      const stopReason = stopAfterFailure(outcome);
      return stopReason ? { findingId: finding.id, reason: stopReason } : null;
    };
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      // Serial, one request per finding, zero automatic retries. Never call the provider API directly.
      const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/explain-finding`, { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(built.request) });
      const bodyText = await response.text();
      if (bodyText.length > 64 * 1024) { stopped = recordFailure('invalid_response', 'oversized_response'); continue; }
      let body: unknown;
      try { body = JSON.parse(bodyText); }
      catch { stopped = recordFailure('invalid_response', 'invalid_json_response'); continue; }
      if (response.status !== 200) {
        const refused = explainErrorSchema.safeParse(body);
        const reason = refused.success ? refused.data.error : `function_status_${response.status}`;
        stopped = recordFailure('function_error', reason);
        continue;
      }
      const result = explainResponseSchema.safeParse(body);
      if (!result.success) { stopped = recordFailure('invalid_response', 'invalid_function_response'); continue; }
      if (result.data.model !== model || result.data.promptVersion !== PROMPT_VERSION || result.data.priceVerifiedOn !== price.verifiedOn) {
        stopped = recordFailure('deployment_response_mismatch', 'deployment_response_mismatch'); continue;
      }
      cache.outcomes.push({ state: 'returned', ...attempt, response: result.data });
      cache.priceSource = 'server-response';
    } catch {
      stopped = recordFailure(controller.signal.aborted ? 'timeout' : 'network_error', controller.signal.aborted ? 'timeout_no_retry' : 'network_error_no_retry');
    } finally { clearTimeout(timer); }
  }
  // Read actual owner-visible ledger receipts, including failed/uncertain reservations that still charge the cap.
  // Pagination is read-only and does not retry a model request.
  for (let offset = 0; ; offset += 1000) {
    const receipt = await client.from('call_ledger').select('id,idempotency_key,model,status,reserve_usd,cost_usd,input_tokens,output_tokens')
      .eq('run_id', cache.runId).eq('owner', identity.data.user.id).order('id').range(offset, offset + 999);
    if (receipt.error || !receipt.data) { cache.ledgerComplete = false; break; }
    for (const row of receipt.data) {
      const outcome = cache.outcomes.find((entry) => entry.state === 'returned' && entry.response.ledgerId === row.id);
      const response = outcome?.state === 'returned' ? outcome.response : null;
      cache.ledgerReceipts.push({ id: row.id, idempotencyKey: row.idempotency_key, model: row.model, status: row.status,
      reserveUsd: Number(row.reserve_usd), costUsd: row.cost_usd === null ? null : Number(row.cost_usd), inputTokens: row.input_tokens,
      outputTokens: row.output_tokens, priceVerifiedOn: response?.priceVerifiedOn ?? null, priceSource: response ? 'server-response' : 'unavailable' });
    }
    if (receipt.data.length < 1000) break;
  }
  return cache;
}
