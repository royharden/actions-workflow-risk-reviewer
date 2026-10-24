// Pure explain-finding schemas (PLAN D11, D12, D17). M3 finalizes it and keeps an independent copy in
// supabase/functions/explain-finding/contract.ts; both are checked against fixtures/contract-examples/.
// The client sends data only: no prompt text and no prompt version (the server owns both, D11).
import { z } from 'zod';
import { RULE_IDS, type RuleId } from '../finding';

/** Request/response contract version. The server rejects a mismatch with 400 (D11). */
export const SCHEMA_VERSION = 1 as const;

export const MAX_EXCERPT_LINES = 60;
/** Whole UTF-8 request bound, checked client-side before any call and server-side while streaming (D12). */
export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_EXPLANATION_CHARS = 1200;
export const MAX_CITATIONS = 8;

const ruleIdSchema = z.enum(RULE_IDS as unknown as [RuleId, ...RuleId[]]);

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
    ruleId: ruleIdSchema,
    // Facts are validated as plain JSON data here; their shape is owned by src/core/finding.ts.
    facts: z.record(z.string(), z.unknown()),
    excerptLines: z.array(excerptLineSchema).min(1).max(MAX_EXCERPT_LINES),
    idempotencyKey: z.string().min(16).max(128),
  })
  .strict();
export type ExplainRequest = z.infer<typeof explainRequestSchema>;

export const triageLabelSchema = z.enum(['confirmed', 'likely_benign', 'unsure']);
export type TriageLabel = z.infer<typeof triageLabelSchema>;

export const citationSchema = z
  .object({
    line: z.number().int().min(1),
    quote: z.string().min(1),
  })
  .strict();

/** What the model must return. Strict: any extra field (severity, patch, ...) rejects the whole answer. */
export const modelOutputSchema = z
  .object({
    triage: triageLabelSchema,
    explanation: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    citations: z.array(citationSchema).min(1).max(MAX_CITATIONS),
  })
  .strict();
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** Successful function response: the raw model text is returned and validated client-side (D13: never stored server-side). */
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
export const explainErrorSchema = z
  .object({
    error: explainErrorCodeSchema,
    message: z.string().optional(),
  })
  .strict();
export type ExplainError = z.infer<typeof explainErrorSchema>;

import { utf8ByteLength } from '../limits';

/** UTF-8 byte length of the serialized request (D12). */
export function requestByteLength(request: ExplainRequest): number {
  return utf8ByteLength(JSON.stringify(request));
}

/** True when the request may be sent; otherwise the caller records `unsure (context truncated)` without a call. */
export function fitsRequestBounds(request: ExplainRequest): boolean {
  return request.excerptLines.length <= MAX_EXCERPT_LINES && requestByteLength(request) <= MAX_REQUEST_BYTES;
}

