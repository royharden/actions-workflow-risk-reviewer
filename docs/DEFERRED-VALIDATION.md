# Deferred validation

This repository was built in **Dirty Mode** (2026-10-24): source only, static checks only. Nothing here has been installed, type-checked,
linted, tested, built, run, deployed or connected to a database or model provider. This file is the **single** list of what is unverified and how
to verify it later (PLAN D22). `BOLT-HANDOFF.md`, `README.md` and `docs/LIMITATIONS.md` link here.

Static checks during construction: independent static review of every milestone; predecessor M0/M1 JSON, fixture YAML syntax and held-out hash checks; later focused source/whitespace/import checks. The final inventory inspected 99 `.ts` files (excluding `.d.ts`): Node 24.14.1 `--check` passed 98 and failed on `src/lib/download.ts` at its `Record<string, string>` type annotation. This failure is recorded, not counted as a pass; TypeScript compilation remains unverified. All 30 JSON/JSONL files parsed, and no relative source imports were missing. TSX was reviewed as source, not parsed by Node.

## Whole repository

| Component | Assumption / skipped check | How to validate later |
|---|---|---|
| Dependencies | `package.json` ranges never installed; no lockfile | `npm install` (commit `package-lock.json`), then `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| TypeScript | code written for `strict`; never type-checked (no `tsc` available) | `npm run typecheck`; fix errors |
| ESLint | core-purity rules (no DOM/Node/fetch in `src/core`) never executed | `npm run lint` |
| Tests | every `tests/**` file written, never run | `npm test`; failures are real findings, not flakes |
| Fixture manifest | `scripts/check-manifest.ts` never run | `npm run check:manifest` must exit 0 |
| Held-out integrity | held-out commit `3573f14` precedes any rule commit; lock hashes | `git log --oneline -- fixtures/workflows/heldout src/core/rules`; `npm run check:manifest` |

## M1 — parser and rules (`yaml` v2 API assumptions, from the M1 author)

| # | Assumption | Check |
|---|---|---|
| a | `parseDocument(text, {version:'1.2', schema:'core', keepSourceTokens:true, uniqueKeys:true, prettyErrors:false, lineCounter})` is valid and the result types as `Document` | `npm run typecheck`; `tests/core/parse.test.ts` |
| b | multi-document, duplicate keys, unclosed flow sequence and colon-space plain scalars land in `doc.errors` (not thrown) with `pos` | `tests/core/parse.test.ts` |
| c | empty values (`gollum:`) are a null Scalar with range or `pair.value === null` (both handled) | parse tests |
| d | `node.range` = `[start, valueEnd, nodeEnd]` in input code units; block scalars start at the indicator, quoted include quotes | span tests in `tests/core/rules.test.ts`, `dev-fixtures.test.ts` |
| e | anchored nodes carry `.anchor`, `Alias` carries `.source`; walker binds aliases in document order | `tests/core/aliases.test.ts` |
| f | a self-referencing alias composes without a `doc.errors` entry, so the walker reports `unsupported (cycle)`; if yaml reports an error instead, the cycle test gets `error` | `tests/core/aliases.test.ts` cycle case |
| g | under 1.2 core with merge off, `<<` is a plain Scalar key | `h24`/merge-key tests (`unsupported`) |
| h | `Scalar.type` values as documented; `on` read from source text stays `"on"` | parse tests |
| i | `[a: b]` in a flow sequence arrives as a YAMLMap item | parse tests |
| j | `new Parser().parse(text)` CST exposes every comment token incl. after a block-scalar header | `tests/core/blank-comments.test.ts` |
| k | exports used: `LineCounter, parseDocument, isAlias, isMap, isPair, isScalar, isSeq, Parser` + types | typecheck |
| l | `contexts.json` `docAnchor` URL still resolves | open the URL |
| m | expected-status and every dev manifest item reproduce exactly (incl. named FN d17:38) | `tests/core/dev-fixtures.test.ts` |

## Later milestones

Rows are added by M2–M5 (gates/fixers/checker, triage + function + ledger, eval/baselines, persistence/auth/handoff).

## Codex successor construction — pending activation

All following checks are deferred under Roy's 2026-10-24 S25 Dirty Mode grant. Test source is not test execution. Any static checks recorded in STATUS/HANDOFF are attributed to their authors.

| Component | Assumption / skipped check | Exact later validation |
|---|---|---|
| M2 gates/fixers/checker | Six gates, narrow shell grammar, AST/byte allowlist, multiset identity and sequential aggregate export need runtime verification | `npm test -- tests/core/gates.test.ts tests/core/editops.test.ts tests/core/fixers.test.ts tests/core/patchcheck.test.ts tests/core/aggregate.test.ts tests/core/rulings.test.ts tests/core/export.test.ts`; manually inspect up to20 passing diffs separately |
| M2 UI/storage | Replay, changed-file review, storage fallback, edited inputs and Blob downloads unexercised | `npm run dev`; follow README demo journey in browser, disable storage/force quota, rescan/edit/export |
| M3 citation/triage | Strict schemas, complete <=60-line excerpt, request bytes, lexical citations and D10 combination | `npm test -- tests/core/cited.test.ts tests/core/combine.test.ts tests/lib/explanations.test.ts tests/lib/mode.test.ts`; browser bad-citation demo |
| Contract reconciliation | Browser schemas moved to pure core/cited/schema.ts and re-exported through providers/contract.ts; deployed copy remains independent. M2 check accepts optional sixth FixContext for authoritative pin data | `npm run typecheck`; `npm test -- tests/contracts.test.ts`; inspect fixture parity and checker callers |
| Edge function | Deno dependencies/deployment, gateway JWT, user verification, CORS | `deno check --config supabase/functions/explain-finding/deno.json supabase/functions/explain-finding/index.ts`; deploy only after authorization; exercise user/anon/foreign origin/missing-config |
| Request bound | Stream cancellation and UTF-8 multibyte boundary | `npm test -- tests/function-handler.test.ts`; authorized HTTP 16384/16385-byte cases, no provider call on refusal |
| Ledger | SQL/RPC grants, own-row RLS, exact parent ownership, effective charges, terminal transitions | Apply migrations in order to authorized isolated target; as anon/user invoke RPCs and verify denied; exercise service reserve/settle plus duplicate/conflict branches |
| Atomic budgets | Owner/day + run caps, UTC rollover | Concurrent reservations near a tiny configured cap; verify total effective charges never exceed daily/run limits; repeat across UTC midnight |
| Model/pricing | Candidate model and every price unverified; no deployed defaults can call model | Verify current provider model list/prices; record dated verifiedOn before configuration; one authorized capped synthetic call |
| Token reservation | Byte-token upper bound plus1024 framing allowance is unproven | Check against actual provider tokenizer/usage on maximal bounded requests before enabling paid calls |
| Default budget | SQL fallback exactly USD1; non-1 EXPLAIN_DEFAULT_DAILY_USD refuses503 | Configure lower per-user user_budgets through service administration; review any future durable environment-default override before using |
| Price provenance | Fixed six-argument reserve RPC does not persist verifiedOn; handler checks price before reserving | Verify server-returned priceVerifiedOn date alongside model/ledgerId against actual ledger costs and pinned deployed pricing; SQL itself does not persist the date |
| M4 measurements | Eval, adapters, baseline provenance and output formats unrun | `npm run check:manifest`; `npm run eval`; capture real scanner output using docs/BASELINES.md only after verifying versions/flags; inspect invalid/missing states |
| Capped live eval | No JWT, keys, paid calls, model cache or measurements created | Set EVAL_USER_JWT and public connection variables locally; inspect scripts/live-client.ts instructions; authorize explicit capped live run, verify ledger receipts and omitted ids |
| M5 persistence/auth | Source-only email signup/signin/signout/recovery, saved snapshots and rulings | `npm test -- tests/lib/repository.test.ts`; configure Site URL/redirect allowlist/email; real userA/userB/anon access, foreign-parent ruling attempts, save/reload/switch-user |
| CI specification deviation | No baselines.yml or ci.yml in Dirty Mode; zero findings unmeasured | Follow docs/CI.md; verify upstream action/tool SHAs, create workflows only after Dirty Mode closes; run scripts/scan-self.ts then authorized dispatch |
| Secret hygiene | No real credential files read; source only uses placeholder/environment names | Run a secret scanner over product repository and history before publication; inspect any finding, no blanket suppressions |
| Browser/edge compatibility | .ts extension imports enabled for noEmit Node tests; Deno deployment bundling unverified | `npm run typecheck`; separate Deno check above; complete demo then configured browser journey |
| Third-party/taxonomy | No hazmat corpus vendored; baseline mapping granularity/version assumptions | Verify licenses and pinned authoritative taxonomy before external additions; keep separately scored provenance |


| Final syntax inventory | Node --check rejected download.ts at its Record type annotation (98/99 syntax invocations passed); compiler/TSX execution unavailable | npm run typecheck after authorized install; resolve any real compiler errors before runtime acceptance |
