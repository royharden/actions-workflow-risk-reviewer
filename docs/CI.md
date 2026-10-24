# Deferred CI and dogfood contract

No `.github/workflows/` scaffold is created in Dirty Mode. The spec's baseline workflow and zero-findings dogfood workflow are deferred intentionally. Source and test files have not been executed; see [deferred validation](DEFERRED-VALIDATION.md).

At activation, verify supported Node/package versions, install dependencies with a lockfile, then run the existing package scripts for typecheck, lint, tests and production build. Validate the fixture manifest/held-out lock and run offline evaluation. Run `tsx scripts/scan-self.ts` once the repository owns actual workflow files; it refuses to claim a clean dogfood result when the directory is absent or empty, when a file is unsupported/error, or when any finding remains.

The later `ci.yml` should run on the project's approved triggers, with explicit `permissions: contents: read`, timeouts, no unnecessary secrets, and every remote action pinned to a verified full commit SHA. Use named placeholders `CHECKOUT_SHA_TO_VERIFY`, `SETUP_NODE_SHA_TO_VERIFY`, `UPLOAD_ARTIFACT_SHA_TO_VERIFY` while preparing it; never commit invented SHAs. Verify tag-to-commit provenance before creating the workflow. The rule scanner must report zero findings on the resulting CI source.

The later `baselines.yml` should be manually dispatched on this repository only. Use the verified local-fixture commands, pinned versions/configuration and output targets in [BASELINES.md](BASELINES.md). It must not scan a third-party repository, apply patches, push code or launch exploit modes. Commit real baseline outputs with complete metadata after inspecting them. Sample fixtures under `fixtures/baselines/samples/` are not scanner results.

Record actual command outcomes and failing checks at activation. A structural/static source review does not constitute successful CI, evaluator execution, deployment or release acceptance.
