# Task Context: RFC-002 Security Hardening

Session ID: ses_3fb60b1c4ffeXBH55xrUiTQ46m
Created: 2026-01-28
Status: in_progress

## Current Request
Implement RFC-002: Security Hardening for the geocoder project. This includes adding rate limiting, input validation, security headers, fixing dependency placement, adding CI security scans, monitoring, documentation (SECURITY.md), and tests as described in RFC-002.

## Requirements
- Implement app-level rate limiting in packages/cli (register before routes)
- Enforce input validation on /search query (Zod schema + handler checks)
- Add @fastify/helmet with CSP compatible with Swagger UI
- Move runtime dependencies from devDependencies to dependencies in packages/core/package.json
- Remove unused root dependencies if not referenced
- Add CI security workflow (.github/workflows/security.yml)
- Add tests (rate-limit, validation, headers) following test-coverage.md
- Add SECURITY.md and docs updates
- Expose monitoring/metrics for rate-limits and validation failures

## Decisions Made
- Application-level rate limiting (fastify) is chosen over cloud-only solutions for immediate mitigation.
- Defaults: RATE_LIMIT_MAX=100, RATE_LIMIT_WINDOW=1 minute; configurable via env/AppOptions.
- Provide env toggles to disable features in emergencies (RATE_LIMIT_ENABLED, HELMET_ENABLED).

## Files to Modify/Create
- packages/cli/src/app.ts  -- register @fastify/rate-limit and @fastify/helmet, update route schema/handler
- packages/cli/package.json -- add dependencies for rate-limit and helmet
- packages/core/package.json -- move undici/type-fest to dependencies
- package.json (root) -- remove unused dependencies if safe
- packages/cli/src/config.ts (new optional) -- centralize env parsing
- packages/cli/src/app.spec.ts -- add tests for rate-limit, validation, headers
- .github/workflows/security.yml -- new CI workflow
- SECURITY.md -- new doc
- .tmp/tasks/ (output tasks from TaskManager)

## Static Context Available (please read these before starting)
- .opencode/context/core/standards/code-quality.md
- .opencode/context/core/standards/test-coverage.md
- .opencode/context/core/standards/documentation.md
- .opencode/context/core/workflows/code-review.md
- .opencode/context/core/workflows/task-delegation.md
- packages/cli/src/app.ts (current Fastify app entry)
- packages/cli/package.json
- packages/core/package.json

## Constraints/Notes
- Follow project coding standards: Biome formatting, ESM imports with .js extensions, use Debug/consola per AGENTS.md
- Tests must follow AAA pattern and Vitest conventions
- Do not push/publish any changes without explicit PR review

## Instructions for TaskManager
1. Load this context file and the listed static context files.
2. Break RFC-002 implementation into atomic JSON subtasks suitable for separate PRs. Create tasks for each PR listed in the Implementation Plan (rate-limit, validation, helmet, deps, CI, monitoring/docs/tests).
3. For each subtask produce:
   - id (slug)
   - title
   - description
   - filesToChange (list of paths)
   - estimateHours
   - dependencies (other task ids)
   - parallel (true/false)
   - testsRequired (true/false)
4. Output the tasks as JSON files under .tmp/tasks/rfc-002/ (task.json and subtask_01.json ...), and return a summary listing the first task to start.

If any required information is missing, respond with a Missing Information block and stop.
