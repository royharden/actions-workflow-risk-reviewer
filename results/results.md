# Workflow risk evaluation

Status: **not yet measured**. Source prepared; runtime unverified. These files are pending templates, not evaluator output.

Detection rows for rules, rules+gates, rules+model (cached-live), zizmor regular, zizmor pedantic and poutine are pending separately for dev and held-out. Every rule will show TP, FP, FN, precision, recall and F1. Triage annotates candidates without changing their severity or removing them.

| Section | Status |
|---|---|
| Per-rule detection, dev | not yet measured |
| Per-rule detection, held-out | not yet measured |
| Gates-only triage k/n and j/m | not yet measured |
| Paired gates / model-only / combined triage k/n and j/m | not yet measured |
| Fixes produced / rejected by checker reason / passed | not yet measured |
| Citations supported / unsupported | not yet measured |
| Cost per run / per charged finding; ledger model and server price date | not yet measured |
| Named false negatives / wrongly demoted items / coverage failures | not yet measured |
| Separate human inspection of up to 20 passing fixes | not yet measured |

k/n means flagged-benign matched candidates demoted; j/m means matched positives wrongly demoted. Denominators and omitted finding IDs will be printed. Missing model answers, denied calls, unavailable receipts and invalid provenance remain visible.

Small fixture sets do not establish real-world accuracy. n < 3 is **not measurable on this set**; zero denominators are **N/A**. Mapped rules differ in granularity. Dev/held-out, regular/pedantic personas and hand-written/live data are never pooled. Handmade format samples and simulated explanations are excluded from measured rows.

Human checks belong in a separately signed artifact and never enter automated counts. Passing fixes pass the six rules; behaviour remains unverified.

After activation, `npm run eval` generates these artifacts offline. `--live` explicitly enables the capped server-function path once all configuration and pricing checks pass. See [baseline activation](../docs/BASELINES.md) and [deferred validation](../docs/DEFERRED-VALIDATION.md).
