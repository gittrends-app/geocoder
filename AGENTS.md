# Agent Guidelines for @gittrends-app/geocoder

This document provides comprehensive guidelines for AI coding agents working in this repository.

## Project Overview

**Tech Stack:**

- **Language:** TypeScript (ES Modules)
- **Runtime:** Node.js >=20.0.0
- **Build System:** Turbo (monorepo orchestration), tsup (bundling), tsc (type definitions)
- **Package Manager:** Yarn 1.22.22
- **Formatter/Linter:** Biome 2.3.10
- **Testing:** Vitest 4.x with @vitest/coverage-v8
- **Project Type:** Monorepo with workspaces (packages/core, packages/cli)

**Purpose:** Geocoding service that resolves GitHub user location strings to standardized addresses using OpenStreetMap/Nominatim and additional providers (e.g., LocationIQ).

## Project Structure

```
geocoder/
├── packages/
│   ├── core/           # Core geocoding library
│   │   ├── src/
│   │   │   ├── entities/      # Data models (Address, etc.)
│   │   │   ├── geocoder/      # Geocoder implementations & decorators
│   │   │   └── helpers/       # Utility functions
│   │   └── package.json
│   └── cli/            # CLI server application (Fastify)
│       ├── src/
│       └── package.json
├── biome.json          # Formatter/linter config
├── turbo.json          # Monorepo task orchestration
└── package.json        # Root workspace config
```

## Build, Lint, Test Commands

### Root Level (runs across all packages via Turbo)

```bash
yarn build              # Build all packages
yarn lint               # Lint all packages
yarn format             # Format all files
yarn test               # Test all packages
yarn verify             # Run all checks (lint + test + build)
```

### Package Level

```bash
cd packages/core        # or packages/cli
yarn lint               # Lint specific package
yarn lint:fix           # Auto-fix issues
yarn format             # Format specific package
yarn test               # Test specific package (core only)
yarn build              # Build specific package
```

### Running a Single Test File

```bash
# Run a specific test file
cd packages/core
npx vitest run src/geocoder/decorators/Cache.spec.ts

# Run tests matching a pattern
npx vitest run --grep "Cache"

# Watch mode for specific file
npx vitest src/geocoder/decorators/Cache.spec.ts
```

## Code Style Guidelines

### Formatting (Biome-enforced)

- **Indentation:** 2 spaces
- **Line Width:** 100 characters
- **Line Ending:** LF (Unix-style)
- **Quotes:** Single quotes for JS/TS, double quotes for JSX
- **Semicolons:** Always required
- **Trailing Commas:** None (as-needed)
- **Arrow Parens:** Always use parentheses `(x) => x`
- **Bracket Spacing:** Yes `{ foo: 'bar' }`

### Imports

```typescript
// ESM with .js extensions (REQUIRED), node: protocol for built-ins, type imports
import { Address } from '../entities/Address.js';       // Internal (with .js)
import type { MergeExclusive } from 'type-fest';        // External type-only
import { constants } from 'node:zlib';                  // Node built-in
import pJson from '../package.json' with { type: 'json' };  // JSON assertion
// Biome auto-organizes: node built-ins → external → internal
```

### Type Usage

```typescript
// Zod schemas for validation, z.infer for types, type-fest for complex types
export const AddressSchema = z.object({
  source: z.string(),
  confidence: z.coerce.number(),
  country_code: z.string().toUpperCase().optional()
});
export type Address = z.infer<typeof AddressSchema>;
```

### Naming Conventions

- **Classes:** PascalCase (`OpenStreetMap`, `Cache`, `LoadBalancer`)
- **Interfaces/Types:** PascalCase (`Geocoder`, `Address`, `BaseOpenStreetMapOptions`)
- **Functions/Methods:** camelCase (`search`, `createApp`, `createCache`)
- **Variables:** camelCase (`cachedAddress`, `mockGeocoder`, `debug`)
- **Constants:** camelCase or UPPER_SNAKE_CASE (`debug`, `DEBUG_NAMESPACE`)
- **Files:** PascalCase for classes (`Cache.ts`, `OpenStreetMap.ts`), camelCase for utilities
- **Test Files:** `.spec.ts` suffix (`Cache.spec.ts`, `Fallback.spec.ts`)

### Error Handling

```typescript
// Throw errors for invalid input, try-catch for async, return null for "not found"
if (!valid) throw new Error('Invalid configuration provided');

try {
  await app.listen({ host, port });
} catch (error) {
  consola.error(error);
  process.exit(1);
}

async search(q: string): Promise<Address | null> {
  if (notFound) return null;  // Not found is NOT an error
}
```

### Logging & Debugging

```typescript
// Use Debug (core) or consola (CLI). NEVER console.log (Biome error)
import Debug from 'debug';
const debug = Debug('geocoder:cache');
debug('searching for: %s', q);
consola.info('Server listening...');  // CLI: import consola from 'consola'
```

## Testing Conventions

```typescript
// Vitest with .spec.ts files alongside source
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Cache', () => {
  const mockGeocoder = { search: vi.fn() } as unknown as Geocoder;
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache(mockGeocoder, { size: 100, ttl: 60 });
  });

  it('should return cached address if available', async () => {
    vi.spyOn(cache['cache'], 'get').mockResolvedValueOnce(cachedAddress);
    const result = await cache.search('test');
    expect(result).toEqual(cachedAddress);
  });
});

// Test file location: alongside source files
// packages/core/src/geocoder/decorators/Cache.ts
// packages/core/src/geocoder/decorators/Cache.spec.ts
```

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/) using commitlint:

```bash
# Allowed types: ci, chore, docs, ticket, feat, fix, perf, refactor, revert, style
feat: add new geocoding provider
fix: resolve caching issue with null addresses
refactor: extract common validation logic
```

## Additional Notes

- **No console usage:** Use `debug` (core) or `consola` (CLI) instead
- **ESM only:** All packages use `"type": "module"`
- **File extensions:** Always use `.js` in imports (TypeScript ESM requirement)
- **Decorator pattern:** Used extensively for geocoder features (Cache, Throttler, Fallback, LoadBalancer)
- **Zod for validation:** All external data validated with Zod schemas
- **Turbo caching:** Build outputs cached by Turbo, avoid manual cache clearing

## Maintaining This Document

**When to update AGENTS.md:**

- New build tools or test frameworks are added
- Code style guidelines change (biome.json, .editorconfig updates)
- Project structure changes (new packages, directories)
- New development conventions are established
- Commit message format changes (.commitlintrc.json updates)
- New required dependencies or patterns emerge

**How to update:**
When making significant changes to project structure or conventions, update this document. AI agents should suggest updates when config files (package.json, biome.json, turbo.json) change, new patterns are introduced, or testing/build processes evolve.

Keep this file as a single source of truth for AI agents working in this codebase.
