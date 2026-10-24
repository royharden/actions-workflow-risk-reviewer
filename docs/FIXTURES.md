# Fixtures

48 hand-written GitHub Actions workflows under `fixtures/workflows/`: 24 held-out (`heldout/hNN-*.yml`) and 24 dev
(`dev/dNN-*.yml`, the six demo showcase files are `d01`–`d06`). They are inputs to a static analyser and are never run;
nothing lives under `.github/`. Every action SHA, digest and secret name in them is fake (secret-looking values read
`FAKE_TOKEN_DO_NOT_USE` or are only `${{ secrets.NAME }}` references). Own work, MIT.

`fixtures/manifest.json` labels every planted construct; `fixtures/heldout.lock.json` freezes the held-out half;
`scripts/check-manifest.ts` (`npx tsx scripts/check-manifest.ts` from the repo root) validates both.

## How the split was made

The split is **by design, not random**. The held-out half was written first, before any rule code existed, and was
authored to meet the held-out minimums below; the dev half was written afterwards by a different author. `seed: 25` is
recorded in the manifest and lock for traceability only: no random draw assigned files to splits. The author of both
halves is on the same team as the rule author, so scores on either split flatter the app; held-out-first, hashing and the
identical-file baselines are the mitigation, not a cure.

## File conventions

- LF line endings, UTF-8 without BOM, final newline. `.gitattributes` marks `fixtures/workflows/**` as `-text`, so Git never
  rewrites the bytes the lock hashes.
- Defaults, so each file stays focused on its planted items: every remote action is pinned to a fake 40-hex SHA unless the
  item is about `unpinned-uses`; `permissions:\n  contents: read` at workflow level unless the item is about
  `excessive-permissions`; triggers `push` / `workflow_dispatch` / `schedule` and `runs-on: ubuntu-latest` unless the item
  needs otherwise.
- `expectedStatus` per file: `complete`, `error` (the parser must reject it, e.g. malformed YAML) or `unsupported` (parses,
  but uses a shape the app refuses, e.g. a `<<:` merge key or an alias cycle). `error` and `unsupported` files carry no items.

## Labels

| Label | Meaning | How the eval scores it |
|---|---|---|
| `positive` | the rule must fire here | a miss is a false negative |
| `lookalike_excluded` | the rule must **not** fire here | a hit is a false positive against rule precision |
| `lookalike_flagged_benign` | the rule fires by design; the named `gate` should demote it | feeds the triage table ("demoted k of n") |

**Labelling is exhaustive.** Every construct in a fixture that the six rules flag under the rule boundaries is an item
(`positive` or `lookalike_flagged_benign`); otherwise a correct finding would be counted as a false positive. Unlabelled
constructs (for example the many SHA-pinned `uses:` lines) are ones no rule fires on and that are not deliberate traps.
An item with note `expected miss: …` is a positive the rules are known not to catch (a named false negative).

Item fields: `file` (relative to `fixtures/workflows/`), `split`, `rule`, `jobId` (YAML job key, or `null` for
workflow-level items), `stepIndex` (0-based index in that job's `steps`, or `null`), `span` (1-based inclusive lines),
`label`, `trap` (slug, or `""`), `gate` (flagged-benign only, else `null`), `note`. Key order is fixed; the lock hash
depends on it.

## Span conventions (binding on M1 rules)

| Rule | Finding location |
|---|---|
| `unpinned-uses` | the `uses:` line. Step `uses` → jobId + stepIndex; reusable-job `uses` → jobId, stepIndex `null` |
| `excessive-permissions` | missing everywhere (no workflow `permissions` and at least one job without its own) → ONE item, jobId `null`, span = the `jobs:` key line. `write-all` → the `permissions:` line (workflow: jobId `null`; job: jobId). A write scope on a fork-reachable job → the scope line (e.g. `pull-requests: write`), jobId `null` if workflow-level else jobId |
| `privileged-trigger-checkout` | the checkout step: startLine = its `uses:` line, endLine = its `ref:` line; if `ref:` comes before `uses:`, swap so start ≤ end; with no `ref:` line, start = end = the `uses:` line. stepIndex = the checkout step |
| `template-injection` | the line holding the `${{ … }}` expression; one item per expression occurrence (two expressions in one step = two items). An expression reached through a YAML alias is reported at the alias use site |
| `secrets-exposure` | `secrets: inherit` line (jobId, stepIndex `null`); workflow-level `env:` secret entry line (jobId `null`); checkout-then-broad-upload → the upload step, startLine = its `uses:` line, endLine = its `path:` line |
| `self-hosted-on-untrusted-trigger` | the `runs-on:` line of the job |

Fork-reachable triggers: `pull_request`, `pull_request_target`, `issue_comment`, `workflow_run`. Privileged triggers:
`pull_request_target`, `workflow_run`, `issue_comment`. PR-head refs: `${{ github.event.pull_request.head.sha }}`,
`…head.ref`, `refs/pull/${{ … }}/merge`, `${{ github.event.workflow_run.head_sha }}`, `…workflow_run.head_branch`,
`${{ github.head_ref }}`. Broad upload paths: `.`, `./`, `**`, `${{ github.workspace }}`.

## Template-injection contexts (binding for `src/core/contexts.json`)

`attacker_controlled`: `github.event.pull_request.title`, `github.event.pull_request.body`,
`github.event.pull_request.head.ref`, `github.event.pull_request.head.label`,
`github.event.pull_request.head.repo.default_branch`, `github.event.issue.title`, `github.event.issue.body`,
`github.event.comment.body`, `github.event.review.body`, `github.event.review_comment.body`,
`github.event.discussion.title`, `github.event.discussion.body`, `github.event.head_commit.message`,
`github.event.head_commit.author.name`, `github.event.head_commit.author.email`, `github.event.commits.*.message`,
`github.event.pages.*.page_name`, `github.event.workflow_run.head_branch`, `github.event.workflow_run.head_commit.message`,
`github.head_ref`.

`maintainer_controlled`: `inputs.*`, `github.event.inputs.*`.

Not in the list (look-alikes, the rule must not fire): `github.sha`, `github.ref`, `github.run_id`, `github.repository`,
`github.event.pull_request.number`, `github.event.issue.number`, `secrets.*` (secrets are not template injection),
`steps.*.outputs.*` (named false negative), `env.*`. Sinks are `run:` and the `script:` input of `actions/github-script`
only; the same expression in `env:` or in another action's `with:` is excluded.

## Gates → flagged-benign files

Six gates, each annotate-only and each tied to one rule (D9). Base-ref checkout is a rule exclusion, not a gate.

| Gate | Rule | Held-out file (item) | Dev file |
|---|---|---|---|
| `fork-if` | privileged-trigger-checkout | `h19-prt-fork-if.yml` (job `size`, lines 11–13) | see "Dev fixtures" below |
| `author-association` | privileged-trigger-checkout | `h20-comment-author-assoc.yml` (job `bench`, lines 12–14) | |
| `label` | privileged-trigger-checkout | `h17-prt-label-gated.yml` (job `test`, lines 12–14) | |
| `environment` | privileged-trigger-checkout | `h18-prt-environment-gated.yml` (job `integration`, lines 13–16) | |
| `dispatch-only` | template-injection (maintainer class) | `h12-dispatch-job-permissions.yml` (job `deploy`, lines 21 and 23) | |
| `same-repo-callee` | secrets-exposure (`secrets: inherit`) | `h04-inherit-same-repo.yml` (job `deploy`, line 13) | |

## Held-out minimums

Per rule ≥3 `positive` and ≥3 look-alikes (`lookalike_excluded` + `lookalike_flagged_benign`); overall ≥6
`lookalike_flagged_benign` with every gate covered (so ≥4 on `privileged-trigger-checkout`); ≥1 `error` and ≥1
`unsupported` file. Actual held-out counts:

| Rule | positive | lookalike_excluded | lookalike_flagged_benign |
|---|---|---|---|
| unpinned-uses | 6 | 4 | 0 |
| excessive-permissions | 5 | 4 | 0 |
| privileged-trigger-checkout | 4 | 3 | 4 |
| template-injection | 8 | 6 | 2 |
| secrets-exposure | 5 | 5 | 1 |
| self-hosted-on-untrusted-trigger | 4 | 4 | 0 |

65 held-out items over 22 `complete` files, plus `h23-malformed-yaml.yml` (`error`) and `h24-merge-key-step.yml`
(`unsupported`).

## Trap → file table

Spec "Named traps" plus the plan's trap list. Held-out rows below; dev rows are in "Dev fixtures" at the end.

| Trap | Label | Held-out file (lines) |
|---|---|---|
| major-tag (`actions/checkout@v4`) | positive | h01 (11) |
| branch-ref (`@main`) | positive | h01 (12) |
| short-sha | positive | h01 (15) |
| non-hex-40 | positive | h02 (12) |
| local-action | excluded | h01 (19, step); h04 (10, reusable workflow) |
| docker-digest | excluded | h01 (20); h02 (18) |
| docker-tag | positive | h02 (14) |
| reusable-workflow-tag | positive | h03 (11) |
| permissions-missing | positive | h08 (7) |
| permissions-partially-missing | positive | h07 (5) |
| write-all | positive | h02 (7, workflow); h09 (14, job) |
| fork-write-scope | positive | h10 (12) |
| non-fork-write-scope | excluded | h03 (10); h12 (17) |
| permissions-empty | excluded | h11 (4) |
| job-only-permissions | excluded | h12 (13) |
| head-sha-checkout | positive | h14 (13–15, `workflow_run.head_sha`) |
| run-checked-out-code | positive | h13 (12–14, then `npm ci` / `npm run build`) |
| merge-ref-checkout (`ref:` before `uses:`) | positive | h15 (20–22) |
| head-ref-checkout | positive | h16 (10–13) |
| label-gated | flagged benign | h17 (12–14) |
| environment-gated | flagged benign | h18 (13–16) |
| fork-if-gated | flagged benign | h19 (11–13) |
| author-association-gated | flagged benign | h20 (12–14) |
| base-ref-checkout | excluded | h21 (11–13) |
| default-ref-checkout | excluded | h16 (18) |
| non-privileged-head-checkout | excluded | h22 (11–13) |
| pr-title-in-run | positive | h22 (16) |
| pr-body-in-run (second expression, same step) | positive | h22 (19) |
| head-commit-message-in-run | positive | h01 (22) |
| github-sha-in-run | excluded | h22 (18) |
| pr-number-in-run / issue-number-in-run | excluded | h22 (17); h07 (17) |
| secrets-in-run | excluded | h05 (22) |
| expr-in-action-input | excluded | h22 (23) |
| same-expr-in-env | excluded | h22 (29) |
| github-script-injection | positive | h15 (16) |
| steps-outputs-laundering | positive, expected miss | h22 (32) |
| workflow-call-input | positive (maintainer, origin unresolved) | h09 (19) |
| dispatch-input-in-run | flagged benign | h12 (21, 23) |
| anchors-aliases | positive | h07 (12 anchor, 19 alias use site) |
| secrets-inherit-external | positive | h03 (14); h04 (16, SHA-pinned external callee) |
| secrets-inherit-same-repo | flagged benign | h04 (13) |
| workflow-env-secret | positive | h05 (9) |
| job-env-secret / step-env-secret | excluded | h05 (14); h05 (19) |
| persist-credentials-broad-upload | positive | h06 (13–16 `path: .`; 21–24 `${{ github.workspace }}`) |
| persist-credentials-false | excluded | h06 (31–34) |
| narrow-upload-path | excluded | h06 (40–43) |
| quoted-boolean | excluded | h06 (50–53) |
| self-hosted-scalar | positive | h10 (18) |
| self-hosted-array | positive | h16 (16) |
| self-hosted-matrix | positive | h11 (10) |
| self-hosted-workflow-run | positive | h14 (10) |
| self-hosted-dynamic | excluded | h22 (25) |
| self-hosted-push-only | excluded | h08 (14) |
| self-hosted-dispatch-only | excluded | h12 (25) |
| hosted-only-matrix | excluded | h11 (18) |
| ignore-the-rules-comment | (file trap, no item) | h13 (line 2; the file still has a positive) |
| malformed-yaml | `error` file | h23 |
| merge-key | `unsupported` file | h24 |

## Held-out lock

`fixtures/heldout.lock.json` = `{version, seed, freezeDate, files: [{file, sha256}], manifestHeldoutSha256, note}`.
Each `sha256` is `sha256sum` of the committed bytes. `manifestHeldoutSha256` is SHA-256 (hex) of
`JSON.stringify(items)` with no whitespace, where `items` are the held-out manifest items with keys in schema order
(`file, split, rule, jobId, stepIndex, span{startLine, endLine}, label, trap, gate, note`), sorted by `file`, then
`span.startLine` (numeric), then `rule`, then `jobId` (`null` as `""`), then `label`, comparing strings by code unit
(`<`/`>`, not locale). The order is total: `check-manifest.ts` rejects two items that tie on those five keys. Any later
edit to a held-out file or item needs a new lock `version` and a contamination note.

## Dev fixtures

Author: 0522_Claude_Opus55_Sub_M0-DevAuthor, 2026-10-24. Covers `fixtures/workflows/dev/d01`–`d24` and
the dev entries of `fixtures/manifest.json` (117 items over 24 files). Paths are relative to `fixtures/workflows/`. Line numbers are 1-based and follow
the "Span conventions" section above.

### Demo showcase (d01–d06, in demo order)

| File | What it shows | Items |
|---|---|---|
| `dev/d01-prt-head-checkout.yml` | `pull_request_target` checkout of `head.sha`, then `npm ci` / `npm test` | privileged-trigger-checkout positive, L15–17 |
| `dev/d02-prt-label-gated.yml` | label-gated twin of d01 (`types: [labeled]`, job `if:` on `safe-to-test`) | privileged-trigger-checkout flagged benign (label), L16–18 |
| `dev/d03-pr-title-body-injection.yml` | two attacker-controlled expressions in one `run:` step: title unquoted (L16), body inside double quotes (L17); bash via `ubuntu-latest`, so both are env-indirection candidates | template-injection positive ×2 |
| `dev/d04-dispatch-input-injection.yml` | `inputs.target` in `run:` under a `workflow_dispatch`-only trigger | template-injection flagged benign (dispatch-only), L19 |
| `dev/d05-unpinned-checkout.yml` | `actions/checkout@v4` (L14) and `actions/setup-node@v4` (L15) are in `pins.json`; `actions/cache@v4` (L18) is deliberately absent, which demonstrates `pin_not_in_table` | unpinned-uses positive ×3 |
| `dev/d06-malformed-yaml.yml` | unterminated flow sequence `branches: [main` | `expectedStatus: error`, no items |

### Trap → file (dev)

| Trap | Label | Dev file : line |
|---|---|---|
| short-sha | positive | `dev/d07-pin-ref-traps.yml`:16 |
| non-hex-40 | positive | `dev/d07-pin-ref-traps.yml`:17 |
| local-action | excluded | `dev/d07-pin-ref-traps.yml`:15; `dev/d08-reusable-and-inherit.yml`:21 (local reusable workflow) |
| docker-digest | excluded | `dev/d07-pin-ref-traps.yml`:21 |
| docker-tag | positive | `dev/d07-pin-ref-traps.yml`:24 |
| reusable-workflow-tag | positive | `dev/d08-reusable-and-inherit.yml`:12 |
| base-ref-checkout | excluded | `dev/d09-prt-base-ref-checkout.yml`:15–17 |
| head-sha-checkout | positive | `dev/d01-prt-head-checkout.yml`:15–17 |
| run-checked-out-code | positive | `dev/d10-workflow-run-head.yml`:15–17 (`workflow_run.head_sha`, then `make`) |
| label-gated | flagged benign | `dev/d02-prt-label-gated.yml`:16–18 |
| environment-gated | flagged benign | `dev/d12-prt-environment-gated.yml`:15–17 |
| fork-if-gated | flagged benign | `dev/d13-prt-fork-if.yml`:15–17 |
| author-association-gated | flagged benign | `dev/d11-issue-comment-author-assoc.yml`:17–19 |
| github-sha-in-run | excluded | `dev/d15-issue-contexts.yml`:25 |
| pr-title-in-run | positive | `dev/d03-pr-title-body-injection.yml`:16 |
| dispatch-input-in-run | flagged benign | `dev/d04-dispatch-input-injection.yml`:19; `dev/d20-permissions-job-only.yml`:22 (`github.event.inputs.*`) |
| same-expr-in-env | excluded | d10:31,32; d14:24; d15:16,17; d16:22,31,40,49,50,60; d17:19–22,35; d18:16–21; d20:30 |
| github-script-injection | positive | `dev/d15-issue-contexts.yml`:33 |
| steps-outputs-laundering | positive (expected miss) | `dev/d17-push-contexts.yml`:38 |
| workflow-call-input | positive (maintainer) | `dev/d14-dispatch-and-call-inputs.yml`:27 |
| anchors-aliases | positive | `dev/d24-anchors-aliases.yml`:19 (scalar alias `uses: *checkout`), :30 (step alias `- *greet_step`) |
| permissions-empty | excluded | `dev/d16-comment-review-discussion-contexts.yml`:14 (workflow level); `dev/d20-permissions-job-only.yml`:12 (job level) |
| job-only-permissions | excluded | `dev/d20-permissions-job-only.yml`:10 |
| write-all | positive | `dev/d21-permissions-write.yml`:7 (workflow level); `dev/d20-permissions-job-only.yml`:33 (job level) |
| fork-write-scope | positive | `dev/d21-permissions-write.yml`:19 |
| secrets-inherit-external | positive | `dev/d08-reusable-and-inherit.yml`:18 |
| secrets-inherit-same-repo | flagged benign | `dev/d08-reusable-and-inherit.yml`:22 |
| workflow-env-secret | positive | `dev/d22-secrets-exposure.yml`:12 |
| persist-credentials-broad-upload | positive | `dev/d22-secrets-exposure.yml`:20–23 (also `'**'` at 60–63) |
| persist-credentials-false | excluded | `dev/d22-secrets-exposure.yml`:31–34 |
| narrow-upload-path | excluded | `dev/d22-secrets-exposure.yml`:40–43 |
| quoted-boolean | excluded | `dev/d22-secrets-exposure.yml`:50–53 |
| self-hosted-matrix | positive | `dev/d23-self-hosted.yml`:28 |
| self-hosted-dynamic | excluded | `dev/d23-self-hosted.yml`:39 |
| self-hosted-push-only | excluded | `dev/d19-permissions-missing.yml`:22 |
| ignore-the-rules-comment | positive (still found) | `dev/d19-permissions-missing.yml`:10 (comment on line 1) |
| malformed-yaml | status `error` | `dev/d06-malformed-yaml.yml` |
| alias-cycle / merge-key | status `unsupported` | held-out only (not in dev) |

Extra dev look-alikes without a trap slug: no-ref default checkout under `pull_request_target` (d09:23, excluded); unknown ref expression
(d09:30–32, positive, `refClass: unknown`); a write scope on a non-fork trigger (d20:25, excluded); a job-level `env:` secret (d22:57,
excluded); workflow `env:` entries with plain values (d17:11, d22:11, excluded); an attacker context inside a job `if:` (d11:22, excluded);
a finite matrix of hosted labels only (d23:35, excluded); non-listed contexts in `run:` (`github.ref`, `github.run_id`, `github.repository`,
`secrets.*` in d15; `env.*` in d17:31; `github.event.pull_request.number` in d18:29).

### Gate → file (dev): flagged benign AND contradictory case

| Gate | Flagged benign (gate demotes) | Contradictory risk (gate must NOT demote; label `positive`) |
|---|---|---|
| fork-if | `dev/d13-prt-fork-if.yml`:15–17 (`head.repo.full_name == github.repository`) | d13:22–24 (sibling job `lint` without the `if:`); d13:30–32 (inverted `!=`, so only fork PRs run) |
| author-association | `dev/d11-issue-comment-author-assoc.yml`:17–19 (job `if:` in a folded `>-` scalar) | d11:25–27 (`author_association` is checked only on a later step's `if:`, so the checkout and `ci.sh` run for anyone) |
| label | `dev/d02-prt-label-gated.yml`:16–18 | `dev/d13-prt-fork-if.yml`:37–39 (label checked only on a later step's `if:`, while `npm ci` runs ungated) |
| environment | `dev/d12-prt-environment-gated.yml`:15–17 | d12:28–30 (`environment:` sits on job `approve`; checkout job `smoke` has none and no `needs:`) |
| dispatch-only | `dev/d04-dispatch-input-injection.yml`:19 (`inputs.*`); `dev/d20-permissions-job-only.yml`:22 (`github.event.inputs.*`) | `dev/d14-dispatch-and-call-inputs.yml`:27, 28 (`workflow_call` also present, so the trigger is not dispatch-only) |
| same-repo-callee | `dev/d08-reusable-and-inherit.yml`:22 (`./.github/workflows/notify.yml`) | d08:18 (callee in another repo, even though SHA-pinned) |

### Contexts coverage (dev)

Each entry has at least one positive in `run:`/`script:` and a benign counterpart (the same expression in `env:`).

| Context | Positive | Benign counterpart |
|---|---|---|
| `github.event.pull_request.title` | d03:16 | d18:16 (env) |
| `github.event.pull_request.body` | d03:17 | d18:17 (env) |
| `github.event.pull_request.head.ref` | d18:25 | d18:18 (env) |
| `github.event.pull_request.head.label` | d18:26 | d18:19 (env) |
| `github.event.pull_request.head.repo.default_branch` | d18:27 | d18:20 (env) |
| `github.event.issue.title` | d15:21, d15:33 (github-script) | d15:16 (env) |
| `github.event.issue.body` | d15:22 | d15:17 (env) |
| `github.event.comment.body` | d16:25 | d16:22 (env); d11:22 (job `if:`) |
| `github.event.review.body` | d16:34 | d16:31 (env) |
| `github.event.review_comment.body` | d16:43 | d16:40 (env) |
| `github.event.discussion.title` | d16:53 | d16:49 (env) |
| `github.event.discussion.body` | d16:54 | d16:50 (env) |
| `github.event.head_commit.message` | d17:27 | d17:19, d17:35 (env) |
| `github.event.head_commit.author.name` | d17:28, d24:26, d24:30 (alias) | d17:20 (env) |
| `github.event.head_commit.author.email` | d17:29 | d17:21 (env) |
| `github.event.commits.*.message` | d17:30 (`commits[0]`) | d17:22 (env) |
| `github.event.pages.*.page_name` | d16:63 (`pages[0]`) | d16:60 (env) |
| `github.event.workflow_run.head_branch` | d10:35 | d10:31 (env) |
| `github.event.workflow_run.head_commit.message` | d10:36 | d10:32 (env) |
| `github.head_ref` | d18:28 | d18:21 (env) |
| `inputs.*` (maintainer) | d14:27 | d14:24 (env); d04:19 (flagged benign) |
| `github.event.inputs.*` (maintainer) | d14:28 | d20:30 (env); d20:22 (flagged benign) |

### Pins (`fixtures/pins.json`, fixture-only)

`actions/checkout@v4` → `c0ffee00…ee04`, `actions/setup-node@v4` → `c0ffee00…ee14` (fabricated SHAs, `source: "fixture-only"`). Deliberately
absent: `actions/cache@v4` (d05:18). Every other unpinned dev ref (d07, d08:12) is also absent, so each one yields "needs lookup". The
`actions/checkout@v4` anchor in d24:14 has a pin key, but the fixer must refuse it because the node is aliased.

## Notes for readers of the eval (added by INT after dev review)

- **Pin SHAs are not looked up.** Every 40-hex SHA in the fixture workflows and in `fixtures/pins.json` is fixture data. Some may coincide with real
  upstream commits; none has been verified and none may be copied into a real workflow (`docs/CI.md` requires verification upstream).
- **Index normalisation.** `[N]` array indexes in an expression (e.g. `github.event.commits[0].message`, `github.event.pages[0].page_name`) are matched
  as `.*.` segments against `src/core/contexts.json` (d16:63, d17:30).
- **Deliberate unknown-ref false positive.** d09:30–32 checks out `${{ steps.resolve.outputs.ref }}` under `pull_request_target`; the rule cannot resolve
  the ref and fires with `refClass: unknown` (labelled `positive`). In reality it resolves to `main`, so this item will inflate apparent precision
  only if the labelling is read as ground truth about exploitability; it is labelled to match the rule boundary.
- **Broad-upload coverage.** Dev fixtures use `.` and `**` broad paths as positives; `${{ github.workspace }}` appears only in an excluded case (d22:50–53)
  and `./` not at all in dev. Unit tests in `tests/core/rules.test.ts` cover both inline.
