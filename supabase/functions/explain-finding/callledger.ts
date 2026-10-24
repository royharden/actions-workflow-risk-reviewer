export type Refusal = 'forbidden_run' | 'over_budget' | 'conflict' | 'in_progress' | 'no_retry' | 'unavailable';
export type ReserveResult = { result: 'reserved'; ledgerId: string } | { result: Refusal };
export interface ReserveInput { owner: string; runId: string; idempotencyKey: string; requestDigest: string; model: string; reserveUsd: number }
export interface SettleInput { id: string; inputTokens: number; outputTokens: number; costUsd: number; status: 'settled' | 'failed' | 'uncertain' }
export interface Ledger {
  ownsRun(owner: string, runId: string): Promise<boolean>;
  reserve(input: ReserveInput): Promise<ReserveResult>;
  settle(input: SettleInput): Promise<void>;
}
/** Narrow interface keeps the RPC wrapper inspectable/testable without importing the deploy SDK. */
export interface LedgerClient {
  readRun(owner: string, runId: string): Promise<{ kind: string; cap_usd: number | null } | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}
const refusals: readonly string[] = ['forbidden_run', 'over_budget', 'conflict', 'in_progress', 'no_retry', 'unavailable'];
export function createLedger(client: LedgerClient): Ledger {
  return {
    async ownsRun(owner, runId) {
      const run = await client.readRun(owner, runId);
      return run !== null && (run.kind === 'review' || (run.kind === 'eval' && run.cap_usd !== null && run.cap_usd > 0 && run.cap_usd <= 1));
    },
    async reserve(input) {
      const { data, error } = await client.rpc('reserve_call', { p_owner: input.owner, p_run_id: input.runId,
        p_idempotency_key: input.idempotencyKey, p_request_digest: input.requestDigest, p_model: input.model, p_reserve_usd: input.reserveUsd });
      if (error || !data || typeof data !== 'object') throw new Error('Ledger unavailable');
      const row = data as Record<string, unknown>;
      if (row.result === 'reserved' && typeof row.ledger_id === 'string' && /^[0-9a-f-]{36}$/i.test(row.ledger_id)) return { result: 'reserved', ledgerId: row.ledger_id };
      if (typeof row.result === 'string' && refusals.includes(row.result)) return { result: row.result as Refusal };
      throw new Error('Invalid ledger response');
    },
    async settle(input) {
      const { data, error } = await client.rpc('settle_call', { p_id: input.id, p_input_tokens: input.inputTokens,
        p_output_tokens: input.outputTokens, p_cost_usd: input.costUsd, p_status: input.status });
      if (error || data !== true) throw new Error('Ledger settlement unavailable');
    },
  };
}
