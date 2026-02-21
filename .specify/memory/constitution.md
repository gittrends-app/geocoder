<!--
Sync Impact Report
- Version change: template -> 1.0.0
- Modified principles:
  - Principle slot 1 -> I. Code Quality Is Enforced
  - Principle slot 2 -> II. Testing Is Mandatory and Risk-Based
  - Principle slot 3 -> III. User Experience Must Stay Consistent
  - Principle slot 4 -> IV. Performance Requirements Are Defined Up Front
- Added sections:
  - Engineering Standards
  - Delivery Workflow & Quality Gates
- Removed sections:
  - Placeholder principle slot 5 removed to keep four focused principles
- Templates requiring updates:
  - ✅ updated .specify/templates/plan-template.md
  - ✅ updated .specify/templates/spec-template.md
  - ✅ updated .specify/templates/tasks-template.md
  - ✅ verified .specify/templates/commands/*.md (no command template files present)
- Follow-up TODOs:
  - None
-->

# Gittrends Geocoder Constitution

## Core Principles

### I. Code Quality Is Enforced

All production code MUST pass linting, formatting, and type checks before merge. Changes MUST
favor clarity over cleverness, use established project conventions (ESM imports with `.js`,
Debug/consola logging instead of console usage), and include focused documentation when behavior
is non-obvious. Pull requests MUST leave touched modules in a maintainable state; known defects or
deferred cleanup MUST be recorded explicitly in the spec or task artifacts.

Rationale: High code quality reduces regression risk, keeps maintenance cost predictable, and
supports reliable collaboration across core and CLI packages.

### II. Testing Is Mandatory and Risk-Based

Every delivered change MUST include automated tests proportionate to risk: unit tests for logic,
integration tests for provider interactions/decorators, and contract/API tests for CLI behavior
when external consumers are affected. Bug fixes MUST ship with a regression test that fails before
the fix. A feature is not complete until required tests pass locally (or in CI) and results are
recorded in plan/tasks artifacts.

Rationale: Risk-based mandatory testing prevents repeat incidents, validates behavior changes, and
preserves confidence when integrating multiple geocoding providers.

### III. User Experience Must Stay Consistent

User-facing behavior MUST be consistent across CLI, API responses, docs examples, and error
messages. New or changed interfaces MUST follow existing naming, response semantics, and language
style unless a documented migration is provided. Feature specs MUST define expected UX behavior,
including edge-case messaging and backward-compatibility impact for existing users.

Rationale: Consistency lowers user confusion, improves trust in outputs, and reduces support
overhead for downstream consumers.

### IV. Performance Requirements Are Defined Up Front

Each feature spec MUST define measurable performance expectations (latency, throughput, memory,
or external API usage) and an explicit validation method. Implementation plans MUST document
constraints and trade-offs before coding. Changes that materially affect performance MUST include
benchmarking or comparative evidence in the implementation record.

Rationale: Declared performance requirements prevent accidental slowdowns and ensure the geocoder
remains efficient under real usage and provider limits.

## Engineering Standards

- The canonical stack remains TypeScript (ESM), Node.js >=20, Yarn workspaces, Turbo, Biome,
  and Vitest; deviations MUST be justified in `plan.md` under Constitution Check.
- Imports MUST use `.js` extensions for internal modules and `node:` protocol for built-ins.
- Logging in core code MUST use `debug`; CLI/service logging MUST use `consola`.
- Any external API dependency MUST define timeout/retry behavior and failure handling strategy.
- Release-impacting changes MUST document compatibility expectations and versioning impact.

## Delivery Workflow & Quality Gates

- `spec.md` MUST include independently testable user scenarios, UX consistency criteria, and
  measurable success metrics.
- `plan.md` MUST pass Constitution Check before implementation starts and after design completion.
- `tasks.md` MUST include explicit tasks for mandatory testing, UX consistency validation, and
  performance verification when performance-sensitive behavior is changed.
- Pull request review MUST reject changes that violate any core principle unless an approved,
  time-bound exception is documented in Complexity Tracking.

## Governance

- This constitution is the highest-priority engineering policy for this repository; when conflicts
  occur, this document overrides lower-level process guidance.
- Amendments require: (1) a documented proposal, (2) explicit update of impacted templates,
  and (3) acknowledgment by repository maintainers in the related change record.
- Versioning policy for this constitution uses semantic versioning:
  - MAJOR: principle removals/redefinitions or governance changes that invalidate prior workflows.
  - MINOR: new principle/section or materially expanded mandatory guidance.
  - PATCH: wording clarifications, typo fixes, or non-semantic refinements.
- Compliance review is required in every implementation plan and pull request; reviewers MUST
  confirm principle adherence or capture approved exceptions with rationale and sunset date.

**Version**: 1.0.0 | **Ratified**: 2026-02-21 | **Last Amended**: 2026-02-21
