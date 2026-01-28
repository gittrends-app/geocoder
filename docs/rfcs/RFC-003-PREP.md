# RFC-003: Reliability Improvements — Phase 0 Prep

This file captures the Phase 0 (prep) artifacts for RFC-003. It contains the branch to use, PR checklist, required tests, and minimal rollout instructions. This is intentionally limited to Phase 0 and Phase 1 prep; observability/metrics work is omitted per project decision.

Branch
------

- rfc/003-reliability

Purpose
-------

Create a safe, reviewable branch and a PR checklist so Phase 1 implementation can be carried out in smaller, testable commits. This prep step does not modify runtime code.

Areas of change (Phase 1)
-------------------------

- packages/core/src/geocoder/decorators/LoadBalancer.ts
- packages/core/src/geocoder/decorators/Cache.ts
- packages/core/src/geocoder/decorators/Throttler.ts
- packages/core/src/geocoder/Photon.ts
- packages/core/src/geocoder/OpenStreetMap.ts
- packages/cli/src/app.ts
- packages/cli/src/cli.ts

Required config/env
-------------------

- LOADBALANCER_QUEUE_TIMEOUT_MS (default: 30000)
- LOADBALANCER_MAX_QUEUE_SIZE (default: 1000)
- GRACEFUL_SHUTDOWN_TIMEOUT_MS (default: 30000)

Required tests (Phase 1)
------------------------

- LoadBalancer
  - Unit: queue rejects when size > MAX_QUEUE_SIZE (QueueFull error)
  - Quick memory test (CI-safe variant): small iteration growth < 10MB

- Cache / Throttler
  - AbortSignal handling: aborted requests reject and do not populate cache
  - Pending dedupe entries are removed on completion/abort

- Photon
  - 403 response returns null
  - 429 response throws RateLimitError (or an Error with 'rate limit')

- OpenStreetMap
  - Malformed responses (missing category/address) return null and do not throw

- CLI
  - /health, /health/ready, /health/live endpoints respond correctly
  - Graceful shutdown handler closes server and flushes cache (if present)

CI considerations
-----------------

- Keep vitest as the test runner; tests must be quick and deterministic
- Memory leak soak (full 7-day) will be run on staging manually. CI will include a short memory regression test (e.g., 1,000 iterations + GC)

PR Checklist (add to PR body)
----------------------------

Please include the following checklist in PR descriptions that implement RFC-003 changes:

- [ ] Linked to RFC-003 (docs/rfcs/RFC-003-Reliability-Improvements.md)
- [ ] Tests added/updated for all changed behavior (see "Required tests" above)
- [ ] Lint/format passes (run `yarn format` and `yarn lint`)
- [ ] No new runtime dependencies without approval
- [ ] Config defaults added and documented (env vars)
- [ ] PR clearly documents rollout plan and rollback criteria
- [ ] Reviewer: confirm code changes follow .opencode/context/core/standards/code-quality.md and test guidance in .opencode/context/core/standards/test-coverage.md

Rollout notes (short)
---------------------

- Deploy to staging after merging to branch and running tests
- Manual soak on staging (48–72 hours for initial validation)
- Canary 10% production traffic if staging is stable

Notes
-----

This file is a Phase 0 artifact only. Implementation (code changes/tests) will be performed in Phase 1 commits on this branch and must follow the above checklist.

If you want, I can create initial PR drafts with these contents as the PR body template. Approval required before any pushes.
