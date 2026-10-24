// Server copy of the explain-finding contract (PLAN D11, D12, D17). Deliberately independent of
// src/lib/providers/contract.ts: the function deploys on its own, so nothing is shared by import. tests/contracts.test.ts
// checks that both copies accept and reject every fixtures/contracts/*.json example identically.
// `zod` is a bare specifier: deno.json maps it to npm:zod@3.23.8; vitest resolves it from node_modules.
import { z } from 'zod';

/** Request/response contract version. A mismatch is rejected with 400 `schema_version_mismatch` (D11). */
export const SCHEMA_VERSION = 1 as const;

export const MAX_EXCERPT_LINES = 60;
/** Whole UTF-8 request bound, enforced with a streamed byte counter before decoding (D12). */
export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_EXPLANATION_CHARS = 1200;
export const MAX_CITATIONS = 8;

// Copied from src/core/finding.ts RULE_IDS; a drift fails tests/contracts.test.ts.
export const RULE_IDS = [
  'unpinned-uses',
  'excessive-permissions',
  'privileged-trigger-checkout',
  'template-injection',
  'secrets-exposure',
  'self-hosted-on-untrusted-trigger',
] as const;

export const excerptLineSchema = z
  .object({
    line: z.number().int().min(1),
    text: z.string(),
  })
  .strict();

export const explainRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: z.string().uuid(),
    findingFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    ruleId: z.enum(RULE_IDS),
    facts: z.record(z.string(), z.unknown()),
    excerptLines: z.array(excerptLineSchema).min(1).max(MAX_EXCERPT_LINES),
    idempotencyKey: z.string().min(16).max(128),
  })
  .strict();
export type ExplainRequest = z.infer<typeof explainRequestSchema>;

export const triageLabelSchema = z.enum(['confirmed', 'likely_benign', 'unsure']);

export const citationSchema = z
  .object({
    line: z.number().int().min(1),
    quote: z.string().min(1),
  })
  .strict();

/** What the model is asked to return. The server never validates it (the client does, D13); kept here for the parity test. */
export const modelOutputSchema = z
  .object({
    triage: triageLabelSchema,
    explanation: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    citations: z.array(citationSchema).min(1).max(MAX_CITATIONS),
  })
  .strict();

export const explainResponseSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    promptVersion: z.string().min(1),
    model: z.string().min(1),
    priceVerifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rawText: z.string(),
    usage: z.object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) }).strict(),
    ledgerId: z.string().uuid(),
  })
  .strict();
export type ExplainResponse = z.infer<typeof explainResponseSchema>;

export const explainErrorCodeSchema = z.enum([
  'method_not_allowed',
  'unauthorized',
  'payload_too_large',
  'bad_request',
  'schema_version_mismatch',
  'not_configured',
  'forbidden_run',
  'over_budget',
  'conflict',
  'in_progress',
  'no_retry',
  'unavailable',
  'provider_error',
]);
export type ExplainErrorCode = z.infer<typeof explainErrorCodeSchema>;

export const explainErrorSchema = z
  .object({
    error: explainErrorCodeSchema,
    message: z.string().optional(),
  })
  .strict();
export type ExplainError = z.infer<typeof explainErrorSchema>;

/** HTTP status for every error code (M3 shared decisions). A settled replay is 410 `unavailable`, never 200. */
export const ERROR_STATUS: Readonly<Record<ExplainErrorCode, number>> = {
  method_not_allowed: 405,
  unauthorized: 401,
  payload_too_large: 413,
  bad_request: 400,
  schema_version_mismatch: 400,
  not_configured: 503,
  forbidden_run: 403,
  over_budget: 429,
  conflict: 409,
  in_progress: 202,
  no_retry: 409,
  unavailable: 410,
  provider_error: 502,
};

const encoder = new TextEncoder();

/** UTF-8 byte length of the serialized request (D12). */
export function requestByteLength(request: unknown): number {
  return encoder.encode(JSON.stringify(request)).byteLength;
}
