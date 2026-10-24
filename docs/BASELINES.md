# Baseline activation contract

Source prepared; runtime unverified. No scanner was installed or run. No measured baseline exists. See the single [deferred validation table](DEFERRED-VALIDATION.md).

The evaluator reads only workflows enumerated by `fixtures/manifest.json`. Dev and held-out each contain 24 files and are evaluated separately, one file at a time through `scanText`; the product's 20-file request limit remains in force. The evaluator checks held-out byte hashes and the canonical held-out label lock before scanning. Do not tune rules against held-out failures during construction.

`fixtures/baselines/samples/*.format.json` contains independently handwritten examples with `source: hand-written-format-sample`, `notAMeasurement: true`, and `formatVerified: false`. Their native JSON shapes are provisional assumptions. Tests exercise those assumptions; passing those tests would not verify compatibility with a real tool. Samples are never read by the evaluator's measured baseline path.

Before activating either adapter, verify the pinned tool's official JSON schema using a real local-fixture run. Reconcile the parser and add a real-output regression if its native shape differs. Do not set `formatVerified: true` until that work is complete. Mapping identifiers in `rules_mapping.json` are also provisional and must be checked against the selected release. Unknown or explicitly unmapped rules remain visible as unmapped counts.

| Setting | Required verified value before measurement |
|---|---|
| Zizmor release / installation command | `ZIZMOR_VERSION_TO_VERIFY` / `ZIZMOR_INSTALL_COMMAND_TO_VERIFY` |
| Zizmor regular command | `ZIZMOR_REGULAR_COMMAND_TO_VERIFY`: JSON output, persona regular, explicit minimum severity, exact fixture split |
| Zizmor pedantic command | `ZIZMOR_PEDANTIC_COMMAND_TO_VERIFY`: JSON output, persona pedantic, explicit minimum severity, exact same fixture split |
| Poutine release / installation command | `POUTINE_VERSION_TO_VERIFY` / `POUTINE_INSTALL_COMMAND_TO_VERIFY` |
| Poutine command | `POUTINE_JSON_COMMAND_TO_VERIFY`: local-only workflow analysis, JSON output, explicit severity/config, exact fixture split |

These are named placeholders, not executable commands or verified flags. The anticipated zizmor options `--format json`, `--persona regular` / `--persona pedantic`, and `--min-severity` must be confirmed against the chosen release. Poutine's JSON/local flags remain unverified. Never use exploit, repository mutation, remote scanning or credential-gathering modes. Baselines use the app's own synthetic fixture files only.

Real outputs belong under `fixtures/baselines/zizmor/` and `fixtures/baselines/poutine/`, with separate files for every split/persona. These directories are deliberately distinct from `samples/`. Keep regular and pedantic rows separate; pedantic results must not be substituted silently for regular results. Record all flags, versions, persona and minimum severity in `metadata.json`.

For each of its six run slots, replace `config: null` and `receipt: null` only after collecting a real output. A configuration is `{tool, version, persona, minSeverity, flags, formatVerified: true}`. `flags` is the exact argument vector, including input scope and all non-default choices. A receipt is:

```json
{
  "schemaVersion": 1,
  "source": "recorded-tool-output",
  "split": "dev",
  "outputFile": "zizmor/dev-regular.json",
  "outputSha256": "<sha256 of exact output bytes>",
  "fileHashes": { "dev/<each manifest file>.yml": "<sha256 of exact workflow bytes>" },
  "manifestSha256": "<sha256 of exact manifest.json bytes>",
  "mappingSha256": "<sha256 of exact rules_mapping.json bytes>",
  "config": { "tool": "zizmor", "version": "<verified release>", "persona": "regular", "minSeverity": "<verified threshold>", "flags": ["<exact argv>"], "formatVerified": true },
  "recordedAt": "<ISO timestamp>"
}
```

The evaluator demands an exact file-hash set, output hash, manifest hash, mapping hash and configuration match. Missing receipts mean **not yet measured**. Wrong hashes, configuration, split, scope or unsupported native output mean **invalid measurement**. Unmapped counts are tool/split totals, repeated beside each per-rule row for context; do not add those repeated totals across rules. Mapping does not make tools equivalent: for example, zizmor `dangerous-triggers` can flag a trigger without this app's checkout condition.

After the required installation and validation are authorized outside Dirty Mode, run `npm run eval`. It generates `results/results.md`, `.json` and `.jsonl`, including TP/FP/FN, precision/recall/F1, triage denominators, fixer outcomes, citations, cost receipts, omissions and named failures. No rate is shown when its denominator is below three; zero denominators are N/A. Both look-alike labels are benign for detection precision. Only flagged-benign labels feed the benign-triage denominator. Each prediction and label can match once; duplicates are false positives.

Live evaluation is separate and explicit: `npm run eval -- --live --live-split heldout --cap-usd 1`. It creates one owner-authenticated `kind=eval` run capped at at most $1, sends requests serially through `explain-finding`, never retries model requests, and stops after budget/auth/config/unknown-outcome failures. Each finding has one ordered outcome: `returned`, `attempted_failure`, `context_refused`, `source_unavailable`, or `not_attempted_after_stop`. Stop omissions name the failed finding that caused the stop. No handwritten answer substitutes for a refused call. All shipped model prices remain unverified, so activation currently refuses before any network request.

Live process variables are `EVAL_USER_JWT`, public `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, `EVAL_MODEL`, `EVAL_DEPLOYED_PRICE_TABLE_SHA256`, and `EVAL_DEPLOYED_PROMPT_VERSION`. The latter two attest that deployment matches the locally verified price table and server prompt. JWTs stay in process memory and never enter result files or logs. Configure and inspect the deployed function first; see BOLT-HANDOFF.md for server configuration.

Cached-live schema version 2 binds the exact ordered finding scope, workflow/manifest hashes, app/rule/prompt versions, model, bounded request, cache key and ledger IDs. Both returned and failed attempts retain their original request/cache key, checked against the current finding and excerpt. Receipts must belong to an attempted request; non-attempts cannot claim ledger charges. Version 1 caches are invalid measurements because they cannot distinguish attempted failures from non-attempts; regenerate them outside Dirty Mode rather than guessing their state. Successful responses supply the server's price date; actual ledger receipts supply model, token usage and charge. The consumer checks those joins. Failed/lost responses can have a retained reserve with an unavailable price date; reports label this partial instead of inventing a date. Settled charges use `cost_usd`; all other ledger statuses retain `reserve_usd`.

The three paired gates/model/final triage rows use the identical attempted-request cohort, printed as `cohortPredictionIds`. Timeouts, function refusals/errors and invalid responses stay in all three rows: the gates row keeps its deterministic label, and model/final are `unsure` under D10. Their matched positive or flagged-benign items remain in the respective denominator. Context refusals and never-attempted findings stay outside this cohort with explicit states/reasons; their IDs remain visible as triage omissions. Citation supported/unsupported counts describe returned answers only, so an attempted request with no usable response can be a citation omission while still belonging to triage. Detection candidates remain unchanged.

Inspect up to 20 passing fixes manually in a separately signed artifact after automated evaluation. Record candidate IDs, reviewer, date, checked diff and observations. Keep those judgments out of automated counts. Passing fixes pass the six rules; behaviour remains unverified.
