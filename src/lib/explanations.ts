import type { Finding } from '../core/finding';
import type { Hasher } from '../core/hash';
import type { InputFile } from '../core/scan';
import { parseWorkflow } from '../core/parse';
import { checkCitations } from '../core/cited/check';
import { buildExplainRequest, explanationCacheKey } from '../core/cited/prompt';
import { explainResponseSchema, type ModelOutput } from '../core/cited/schema';
import { combine, type CombinedTriage } from '../core/combine';
import type { AppMode } from './mode';
import type { ExplainProvider } from './providers';
import { functionProvider } from './providers/function-client';
import { mockProvider } from './providers/mock';
import { getSupabase } from './supabase';

export type ExplanationOrigin = 'live' | 'hand-written';
export type ExplanationOutcome =
  | {
      status: 'supported'; triage: CombinedTriage; origin: ExplanationOrigin;
      output: ModelOutput; excerptLines: { line: number; text: string }[];
      model: string; promptVersion: string; priceVerifiedOn: string; cacheKey: string;
    }
  | { status: 'unsupported'; triage: CombinedTriage; origin: ExplanationOrigin; reason: string };

export interface ExplanationInput {
  finding: Finding;
  source: InputFile;
  userId: string | null;
  runId: string | null;
  consented: boolean;
}

export interface ExplanationSession {
  /** Call on sign-in/out/account changes. Discards answers and queued work from the old identity. */
  setUser(userId: string | null): void;
  /** Discard in-memory answers (for a new review/clear-local-data); never resets a paid attempt into an automatic retry. */
  clear(): void;
  /** Read only: lets a card retain its answer when triage moves it into another group. */
  peek(input: Pick<ExplanationInput, 'finding' | 'userId' | 'runId'>): ExplanationOutcome | null;
  explain(input: ExplanationInput): Promise<ExplanationOutcome>;
}

interface SessionOptions {
  mode: AppMode;
  hasher: Hasher;
  liveProviderForUser?(userId: string): ExplainProvider;
  exampleProviderForFinding?(finding: Finding): ExplainProvider;
}

const DEMO_RUN_ID = '00000000-0000-4000-8000-000000000025';

/** One controller per review screen: one serial queue and no error-to-demo fallback or automatic retries. */
export function createExplanationSession(options: SessionOptions): ExplanationSession {
  let userId: string | null = null;
  let generation = 0;
  let provider: ExplainProvider | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const attempts = new Map<string, Promise<ExplanationOutcome>>();
  const answers = new Map<string, ExplanationOutcome>();
  const views = new Map<string, ExplanationOutcome>();
  const viewKey = (input: Pick<ExplanationInput, 'finding' | 'userId' | 'runId'>) => JSON.stringify([input.userId, input.runId ?? DEMO_RUN_ID, input.finding.id]);
  const origin: ExplanationOrigin = options.mode.kind === 'demo' ? 'hand-written' : 'live';

  function unsupported(finding: Finding, reason: string): ExplanationOutcome {
    return { status: 'unsupported', reason, origin, triage: combine(finding, true, { supported: false, reason }) };
  }

  function clear() {
    generation += 1;
    attempts.clear();
    answers.clear();
    views.clear();
    provider = null;
    // Retain the serial tail: a new account never runs concurrently with a previous in-flight request.
  }

  return {
    setUser(nextUser) {
      if (userId === nextUser) return;
      userId = nextUser;
      clear();
    },
    clear,
    peek(input) { return input.userId === userId ? views.get(viewKey(input)) ?? null : null; },
    async explain(input) {
      const displayEpoch = generation;
      async function perform(): Promise<ExplanationOutcome> {
      const { finding, source } = input;
      const epoch = generation;
      const current = () => epoch === generation && input.userId === userId;
      if (options.mode.kind === 'setup-error') return unsupported(finding, 'setup_error');
      if (!current()) return unsupported(finding, 'session_changed');
      if (options.mode.kind === 'live') {
        if (!userId) return unsupported(finding, 'sign_in_required');
        if (!input.consented) return unsupported(finding, 'consent_required');
        if (!input.runId) return unsupported(finding, 'owned_run_required');
      }
      try {
        if (source.name !== finding.file || await options.hasher.sha256Hex(source.text) !== finding.fileHash) {
          return unsupported(finding, 'source_changed');
        }
        const parsed = parseWorkflow(source.text);
        if (!parsed.ok) return unsupported(finding, 'source_not_reviewable');
        const prepared = await buildExplainRequest(parsed, finding, input.runId ?? DEMO_RUN_ID, options.hasher);
        if (!prepared.ok) return unsupported(finding, prepared.reason);
        if (!current()) return unsupported(finding, 'session_changed');
        const request = prepared.request;
        // The attempt index prevents repeated paid attempts before model/prompt metadata are known.
        const attemptKey = JSON.stringify([userId, origin, request.runId, finding.id, finding.ruleVersion, request.idempotencyKey]);
        const previous = attempts.get(attemptKey);
        if (previous) return previous;
        const task = queue.then(async (): Promise<ExplanationOutcome> => {
          if (!current()) return unsupported(finding, 'session_changed');
          let selected: ExplainProvider;
          if (options.mode.kind === 'demo') {
            selected = options.exampleProviderForFinding?.(finding) ?? mockProvider(finding, options.hasher);
          } else {
            if (!provider) provider = options.liveProviderForUser?.(userId!) ?? null;
            if (!provider) return unsupported(finding, 'live_provider_not_configured');
            selected = provider;
          }
          const response = await selected.explain(request);
          if (!current()) return unsupported(finding, 'session_changed');
          if (!response.ok) return unsupported(finding, response.reason);
          if (response.source !== origin) return unsupported(finding, 'provider_origin_mismatch');
          const checkedResponse = explainResponseSchema.safeParse(response.response);
          if (!checkedResponse.success) return unsupported(finding, 'invalid_response_contract');
          const value = checkedResponse.data;
          const checked = checkCitations(value.rawText, request.excerptLines);
          if (!checked.supported) return unsupported(finding, checked.reason);
          const cacheKey = await explanationCacheKey(finding, request, value.promptVersion, origin, value.model, options.hasher);
          if (!current()) return unsupported(finding, 'session_changed');
          const cached = answers.get(cacheKey);
          if (cached?.status === 'supported' && cached.priceVerifiedOn === value.priceVerifiedOn) return cached;
          const outcome: ExplanationOutcome = {
            status: 'supported', origin, output: checked.output, excerptLines: request.excerptLines,
            model: value.model, promptVersion: value.promptVersion, priceVerifiedOn: value.priceVerifiedOn,
            cacheKey, triage: combine(finding, true, checked),
          };
          answers.set(cacheKey, outcome);
          return outcome;
        }).catch(() => unsupported(finding, 'explanation_failed_no_retry'));
        attempts.set(attemptKey, task);
        queue = task.then(() => undefined, () => undefined);
        return task;
      } catch {
        return unsupported(finding, 'request_preparation_failed');
      }
      }
      const outcome = await perform();
      if (displayEpoch === generation && input.userId === userId) views.set(viewKey(input), outcome);
      return outcome;
    },
  };
}

/** Lazy browser dependencies; no Supabase client or live provider is created in demo mode. */
export function createBrowserExplanationSession(mode: AppMode, hasher: Hasher): ExplanationSession {
  return createExplanationSession({
    mode, hasher,
    liveProviderForUser(expectedUserId) {
      const client = getSupabase();
      const url = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!client || !url || !anonKey) return { async explain() { return { ok: false, reason: 'not_configured' }; } };
      return functionProvider(url, anonKey, async () => {
        const { data, error } = await client.auth.getSession();
        return !error && data.session?.user.id === expectedUserId ? data.session.access_token : null;
      });
    },
  });
}
