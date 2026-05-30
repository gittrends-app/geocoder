# AGENTS.md

## Scope & Stack
- Monorepo with 2 workspaces: `packages/core` (library) and `packages/cli` (Fastify server/CLI).
- Node `>=20`, Yarn `1.22.22`, ESM-only (`"type": "module"`).
- Root package is private; release flow bumps versions in both workspace packages.

## Source of Truth Commands
- Install: `yarn install --frozen-lockfile` (matches CI).
- Full repo checks: `yarn verify` (runs `turbo lint test build`).
- Individual roots:
  - `yarn lint` -> `turbo lint`
  - `yarn test` -> `turbo test`
  - `yarn build` -> `turbo build`
  - `yarn format` -> `biome format --write .`

## Package Commands (faster focused runs)
- Core (`packages/core`):
  - `yarn test` runs `vitest run src`
  - single test: `npx vitest run src/geocoder/decorators/Cache.spec.ts`
  - build: clean + tsup bundle + `tsc --emitDeclarationOnly`
- CLI (`packages/cli`):
  - `yarn test` runs `vitest run tests`
  - single test: `npx vitest run tests/rateLimit.spec.ts`
  - dev server: `yarn dev` (loads env via `dotenv-flow/config`)

## Repo-Specific Gotchas
- Husky pre-commit runs all checks: `turbo lint`, `turbo test`, `turbo build` (slow; expect this on commit).
- Commit messages are enforced by commitlint; allowed types:
  `ci, chore, docs, ticket, feat, fix, perf, refactor, revert, style`.
- Biome linter has `noConsole` = error. Use `debug` in core and `consola` in CLI.
- TypeScript ESM imports must include `.js` extensions for internal imports.

## Architecture Landmarks
- Library export surface: `packages/core/src/index.ts` -> entities + geocoder modules.
- CLI entrypoint: `packages/cli/src/cli.ts`.
- HTTP app wiring: `packages/cli/src/app.ts`.
  - `/search` normalizes and validates `q`.
  - default geocoder is `Fallback(OpenStreetMap, Photon)`, optionally wrapped with `Cache`.
- Env parsing for CLI defaults is centralized in `packages/cli/src/helpers/env.ts`.

## Agent Workflow Hints
- Prefer focused checks while editing:
  1) run tests for changed package
  2) run package lint/build
  3) finish with `yarn verify` when change is cross-package or release-relevant
- Trust scripts/config over README prose if they conflict.
