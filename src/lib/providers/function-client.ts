import { explainErrorSchema, explainResponseSchema, fitsRequestBounds, type ExplainRequest } from './contract';
import type { ExplainProvider, ProviderResult } from './index';

/** One serial queue, no retries. A live error never substitutes a demonstration answer. */
export function functionProvider(url: string, anonKey: string, token: () => Promise<string | null>): ExplainProvider {
  let queue: Promise<unknown> = Promise.resolve();
  const send = async (request: ExplainRequest): Promise<ProviderResult> => {
    if (!fitsRequestBounds(request)) return { ok: false, reason: 'context_truncated' };
    const jwt = await token();
    if (!jwt) return { ok: false, reason: 'Sign in before requesting an explanation.' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/explain-finding`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: anonKey },
        body: JSON.stringify(request), signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > 64 * 1024) return { ok: false, reason: 'oversized_response' };
      let body: unknown;
      try { body = JSON.parse(text); } catch { return { ok: false, reason: 'invalid_response' }; }
      if (!response.ok || response.status !== 200) {
        const error = explainErrorSchema.safeParse(body);
        return { ok: false, reason: error.success ? error.data.error : `function_error_${response.status}` };
      }
      const parsed = explainResponseSchema.safeParse(body);
      return parsed.success ? { ok: true, response: parsed.data, source: 'live' } : { ok: false, reason: 'invalid_response_contract' };
    } catch { return { ok: false, reason: 'network_or_timeout_no_retry' }; }
    finally { clearTimeout(timeout); }
  };
  return {
    explain(request) {
      const result = queue.then(() => send(request));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
