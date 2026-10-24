# GitHub Actions Workflow Risk Reviewer

Source prepared for a browser workbench that reviews pasted or uploaded GitHub Actions YAML with six deterministic rules, annotated gates, source-cited explanations, bounded patch previews, human rulings and downloadable reports.

**Dirty Mode construction — runtime unverified.** Dependencies have never been installed. Type-checking, lint, tests, eval, builds, browser journeys, database migrations, edge deployment and paid model calls have never run. Static review and syntax inspection are not runtime verification. See [deferred validation](docs/DEFERRED-VALIDATION.md) and [Bolt handoff](BOLT-HANDOFF.md).

The six rules cover unpinned actions, excessive permissions, privileged-trigger checkout, template injection, secret exposure and self-hosted runners on untrusted triggers. Findings retain fixed code-assigned severity. Gate and model triage never delete them. A passing patch means **“passes the six rules; behaviour unverified”**, not a guarantee about workflow behavior.

After Dirty Mode closes, install with `npm install`, commit the resulting lockfile, then follow the validation commands in the deferred list. `npm run dev` opens the app; with no configuration, it uses explicit offline demonstration data. Load the six-file demo, scan, inspect gate evidence, request a hand-written example, review a fix, record a ruling and export `report.md`, `findings.json` and `fixes.patch`. Rescanning unchanged files replays rulings; edited files need review again. Fixture-only action pins are fabricated and must never be copied into production workflows.

Demo explanations are hand-written simulated examples, not model output or measurements. One deliberately invalid citation demonstrates unsupported output becoming `unsure`. Live mode requires public Supabase configuration, email sign-in, consent and a configured authenticated function. Provider secrets stay server-side. Missing configuration or a failed live call never silently substitutes demonstration answers.

The evidence claim is deliberately bounded: the evaluation source compares per-rule precision/recall and benign/risky demotion counts on independently labelled synthetic inputs. It does not claim better detection than zizmor. [Results](results/results.md) remain pending until the evaluation runs; recorded external baseline outputs and a capped live-triage run are separate later work. Own synthetic fixtures are MIT; no external workflow corpus is vendored.

Jev/TypeSafe is not built: the flagged-benign set is too small to establish an improvement over gates plus citation-checked generative triage. A future provider slot is documented, with no calls or dependency today.

See [limitations](docs/LIMITATIONS.md), [fixture conventions](docs/FIXTURES.md), [baseline capture contract](docs/BASELINES.md) and [CI activation contract](docs/CI.md). Uploaded files are parsed as data and never executed. The app does not fetch repositories, apply changes, open pull requests or push commits.
