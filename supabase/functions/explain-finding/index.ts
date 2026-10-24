// Deployment wiring only. Guard logic is in the injected handler; clients are lazy so preflight/auth refusals do not reserve.
import { createClient } from '@supabase/supabase-js';
import { createLedger } from './callledger.ts';
import { handle, ProviderFailure, type ProviderOutput } from './handler.ts';

Deno.serve((request: Request) => {
  const env = (name: string): string | undefined => Deno.env.get(name);
  const client = () => createClient(env('SUPABASE_URL') ?? '', env('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } });
  const ledger = createLedger({
    async readRun(owner, runId) {
      const { data, error } = await client().from('runs').select('kind,cap_usd').eq('id', runId).eq('owner', owner).maybeSingle();
      if (error) throw new Error('Run lookup unavailable');
      return data;
    },
    async rpc(name, args) { return await client().rpc(name, args); },
  });
  return handle(request, {
    readEnv: env, ledger, now: () => new Date(),
    async verifyJwt(jwt) {
      const { data, error } = await client().auth.getUser(jwt);
      return error || !data.user ? null : { id: data.user.id };
    },
    async callProvider(input): Promise<ProviderOutput> {
      // No retry. Fetch or body-read failures may happen after billing, hence uncertain by default.
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: input.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: input.model, max_tokens: input.maxTokens, system: input.system,
          messages: [{ role: 'user', content: input.userMessage }] }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        // A definitive 4xx refusal is not a success; 408/429/5xx stay conservative.
        throw new ProviderFailure(response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429 ? 'failed' : 'uncertain');
      }
      const data = await response.json();
      if (!Array.isArray(data.content) || data.content.some((block: { type?: string }) => block.type !== 'text') ||
        data.stop_reason !== 'end_turn' || !data.usage) throw new ProviderFailure('uncertain');
      return { rawText: data.content.map((block: { text: string }) => block.text).join(''),
        inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens };
    },
  });
});
