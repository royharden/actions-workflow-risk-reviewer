# Deferred validation

This repository was built in **Dirty Mode** (2026-10-24): source only, static checks only. Nothing here has been installed, type-checked,
linted, tested, built, run, deployed or connected to a database or model provider. This file is the **single** list of what is unverified and how
to verify it later (PLAN D22). `BOLT-HANDOFF.md`, `README.md` and `docs/LIMITATIONS.md` link here.

Static checks that *were* done during construction: independent static review of every milestone; `node --check` (Node 24 type stripping) syntax
parse of every `.ts` file except `.d.ts`; `JSON.parse` of every JSON file; YAML syntax parse of all 48 fixtures with a preinstalled PyYAML (only the
intended malformed files `d06`, `h23` fail); `sha256sum -c` of the held-out lock.

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
