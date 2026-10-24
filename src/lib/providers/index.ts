import type { ExplainRequest, ExplainResponse } from './contract';
export type ProviderResult =
  | { ok: true; response: ExplainResponse; source: 'live' | 'hand-written'; cacheKey?: string }
  | { ok: false; reason: string };
export interface ExplainProvider { explain(request: ExplainRequest): Promise<ProviderResult> }
// A future typesafe provider is a documented slot only; Jev is deliberately absent.
