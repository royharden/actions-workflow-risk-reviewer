import { ERROR_STATUS, MAX_REQUEST_BYTES, SCHEMA_VERSION, explainRequestSchema, type ExplainErrorCode } from './contract.ts';
import { PRICES, costUsd, lookupVerifiedPrice, type PriceEntry } from './pricing.ts';
import { PROMPT_VERSION, SYSTEM_RULES, buildUserMessage } from './prompt.ts';
import type { Ledger, ReserveResult } from './callledger.ts';

export const MAX_OUTPUT_TOKENS = 600;
export const PROVIDER_TIMEOUT_MS = 20_000;
export interface ProviderInput {
  apiKey: string; model: string; system: string; userMessage: string; maxTokens: number; signal: AbortSignal;
}
export interface ProviderOutput { rawText: string; inputTokens: number; outputTokens: number }
/** A definitive provider refusal is failed; a dispatched request with unknown outcome is uncertain. */
export class ProviderFailure extends Error {
  constructor(readonly outcome: 'failed' | 'uncertain') { super('Provider request failed'); }
}
export interface Dependencies {
  verifyJwt(jwt: string): Promise<{ id: string } | null>;
  readEnv(name: string): string | undefined;
  ledger: Ledger;
  callProvider(input: ProviderInput): Promise<ProviderOutput>;
  now(): Date;
  /** Test injection only; the deployed adapter uses the unverified PRICES table. */
  prices?: readonly PriceEntry[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) as string;
}
/** Digest covers every accepted field, including the key; object-key order is immaterial, array order is not. */
export async function requestDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readBounded(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

/** Guard order is intentional: each refusal returns before all later effects (PLAN D17). */
export async function handle(request: Request, deps: Dependencies): Promise<Response> {
  const origin = request.headers.get('origin');
  const allowed = (deps.readEnv('ALLOWED_ORIGINS') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const originAllowed = !origin || allowed.includes(origin);
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && originAllowed) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const error = (code: ExplainErrorCode): Response => new Response(JSON.stringify({ error: code }), { status: ERROR_STATUS[code], headers });
  // 1. CORS and method. No wildcard origins or credentials; originless CLI clients still need JWT.
  if (!originAllowed) return error('method_not_allowed');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return error('method_not_allowed');
  // 2. Identity comes exclusively from auth.getUser, never a decoded/unverified JWT or anon key.
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!bearer) return error('unauthorized');
  let user: { id: string } | null;
  try { user = await deps.verifyJwt(bearer[1]); } catch { return error('unauthorized'); }
  if (!user) return error('unauthorized');
  // 3. Count bytes before decoding; ignore untrusted Content-Length.
  let text: string | null;
  try { text = await readBounded(request); } catch { return error('bad_request'); }
  if (text === null) return error('payload_too_large');
  // 4. Strict request schema, with a distinct version diagnostic.
  let json: unknown;
  try { json = JSON.parse(text); } catch { return error('bad_request'); }
  if (json && typeof json === 'object' && 'schemaVersion' in json && json.schemaVersion !== SCHEMA_VERSION) return error('schema_version_mismatch');
  const parsed = explainRequestSchema.safeParse(json);
  if (!parsed.success) return error('bad_request');
  const input = parsed.data;
  // 5. Fail closed: no real price is verified in the source. SQL fallback budget is exactly $1.
  const key = deps.readEnv('ANTHROPIC_API_KEY');
  const model = deps.readEnv('ANTHROPIC_MODEL');
  const price = model ? lookupVerifiedPrice(deps.prices ?? PRICES, model) : null;
  const defaultBudget = deps.readEnv('EXPLAIN_DEFAULT_DAILY_USD');
  // Other defaults require a reviewed durable database configuration; never pretend this env changes SQL.
  if (!key || !model || !price || price.verifiedOn > deps.now().toISOString().slice(0, 10) ||
    (defaultBudget !== undefined && defaultBudget !== '' && Number(defaultBudget) !== 1)) return error('not_configured');
  // 6. Check exact run ownership and valid review/eval kind before reserving.
  try {
    if (!(await deps.ledger.ownsRun(user.id, input.runId))) return error('forbidden_run');
  } catch { return error('unavailable'); }
  let userMessage: string;
  let digest: string;
  try { userMessage = buildUserMessage(input); digest = await requestDigest(input); }
  catch { return error('bad_request'); }
  // Conservative byte-token ceiling plus framing allowance; tokenizer assumption must be checked at activation.
  const inputTokenCeiling = new TextEncoder().encode(SYSTEM_RULES + userMessage).byteLength + 1024;
  const reserveUsd = costUsd(price, inputTokenCeiling, MAX_OUTPUT_TOKENS);
  // 7. SQL repeats ownership and performs idempotency before budget under a per-owner lock.
  let reservation: ReserveResult;
  try {
    reservation = await deps.ledger.reserve({ owner: user.id, runId: input.runId, idempotencyKey: input.idempotencyKey,
      requestDigest: digest, model, reserveUsd });
  } catch { return error('unavailable'); }
  if (reservation.result !== 'reserved') return error(reservation.result);
  // 8. Exactly one attempt. Abort is advisory; any unknown result retains its entire reservation.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let output: ProviderOutput;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ProviderFailure('uncertain')); }, PROVIDER_TIMEOUT_MS);
    });
    output = await Promise.race([deps.callProvider({ apiKey: key, model, system: SYSTEM_RULES, userMessage,
      maxTokens: MAX_OUTPUT_TOKENS, signal: controller.signal }), timeout]);
    if (!Number.isSafeInteger(output.inputTokens) || output.inputTokens < 0 || output.inputTokens > inputTokenCeiling ||
      !Number.isSafeInteger(output.outputTokens) || output.outputTokens < 0 || output.outputTokens > MAX_OUTPUT_TOKENS ||
      typeof output.rawText !== 'string') throw new ProviderFailure('uncertain');
  } catch (cause) {
    const status = cause instanceof ProviderFailure ? cause.outcome : 'uncertain';
    try { await deps.ledger.settle({ id: reservation.ledgerId, inputTokens: 0, outputTokens: 0, costUsd: 0, status }); } catch { /* reserved still charges reserve */ }
    return error('provider_error');
  } finally { if (timer !== undefined) clearTimeout(timer); }
  // 9. No raw model/workflow text is ever sent to the ledger. Settlement must succeed before success is returned.
  try {
    await deps.ledger.settle({ id: reservation.ledgerId, inputTokens: output.inputTokens, outputTokens: output.outputTokens,
      costUsd: costUsd(price, output.inputTokens, output.outputTokens), status: 'settled' });
  } catch { return error('unavailable'); }
  return new Response(JSON.stringify({ schemaVersion: SCHEMA_VERSION, promptVersion: PROMPT_VERSION, model, priceVerifiedOn: price.verifiedOn,
    rawText: output.rawText, usage: { inputTokens: output.inputTokens, outputTokens: output.outputTokens }, ledgerId: reservation.ledgerId }),
  { status: 200, headers });
}
