# Bolt handoff — source prepared; runtime unverified

Target: **fresh Bolt Database**, Supabase-compatible client and Deno edge function. No database, function, auth settings, secrets, account or deployment has been provisioned. Inspect any existing target's migration history before applying only pending migrations; do not blindly replay these files on a populated database.

Unverified: dependencies, lockfile, type/lint/tests/eval/build, browser/auth journeys, migrations/RLS, paid-call ledger concurrency, model/pricing and Deno deployment. The single list with later commands is [docs/DEFERRED-VALIDATION.md](docs/DEFERRED-VALIDATION.md). No publication or provisioning is authorized by this document.

## Source inventory

- Import the inner product repository root (the directory containing package.json), not its outer planning folder. Use the final reviewed local commit from `git log`; no remote exists and nothing has been pushed.
- Migration order: `20261024000100_review_tables.sql`, `20261024000200_review_policies.sql`, `20261024000300_call_ledger.sql`. Runs/findings/rulings are immutable snapshots or append-only events, with owner RLS and exact parent-owner constraints. The ledger alone permits guarded settlement transitions; no workflow/model text is stored there.
- Function: `supabase/functions/explain-finding/index.ts`; inspect its local deno.json dependency map and deploy the complete function directory. Gateway JWT verification stays enabled; the handler verifies the actual user and owned run. Configure allowed browser origins; CORS is not authentication.
- Public variables: `VITE_APP_MODE` (`demo` or `live`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Server only: `ANTHROPIC_API_KEY`, required `ANTHROPIC_MODEL`, `ALLOWED_ORIGINS`; platform supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Eval-only process environment: `EVAL_USER_JWT` plus public connection variables. Never prefix secrets with `VITE_`.
- Verify candidate `claude-haiku-5-5` against the provider's current model list before use. All committed prices are unverified, so live calls refuse configuration. Configure dated verified prices and inspect atomic owner/day and run caps before any paid round trip. The default SQL cap is USD 1; lower per-user budgets belong in `user_budgets` through service administration. An unsupported environment default override refuses calls.
- Configure email/password auth, email delivery/confirmation, Site URL and recovery redirect allowlist for the actual preview URL. No storage buckets, Realtime publication, background worker or paid account is required by this app beyond the optional model provider.
- Later commands: `npm install` (record lockfile), `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:manifest`, `npm run eval`, `npm run build`; separate Deno checks and database/auth isolation checks are required.
- No `.github/workflows/` exists in Dirty Mode. [CI](docs/CI.md) and [baseline capture](docs/BASELINES.md) describe later work. This is an explicit deviation from the original dogfood/baselines workflow acceptance, never a zero-findings claim.

## Later inspection/preparation prompt

Inspect this product repository and its deferred-validation list. Confirm the reviewed revision and target migration baseline. Keep Bolt Database as the selected provider. Identify dependencies, edge bundling, email auth/redirect settings, owner isolation and ledger/model/pricing gaps. Return a concrete activation plan with required owner secret entries and checks. Do not publish, provision resources, apply migrations or call a paid model until separately authorized. Preserve existing data, connections and migrations.
