# Geocoder Decorators

This directory contains decorator implementations that add functionality
to geocoder services using the Decorator pattern. Decorators wrap a
Geocoder and enhance behavior such as caching, throttling, fallback,
and load-balancing.

## Available Decorators

### Cache

Adds two-tier caching (memory + optional persistent storage) to any geocoder.

Key behaviors:

- Two-tier storage: in-memory LRU + optional secondary (Keyv) store
- Negative-cache sentinel: cached `false` represents "not found" and is
  respected as a valid cache entry
- Deduplication: concurrent requests for the same query are deduplicated
  using an internal `pending` map which stores the in-flight promise
- Fire-and-forget cache writes: write failures are logged but don't block
  the response

Usage:

```typescript
const geocoder = new Cache(
  new OpenStreetMap(config),
  { size: 1000, ttl: 3600 }
);
```

### Throttler

Limits request rate to comply with API usage policies.

Key behaviors:

- Uses PQueue to limit concurrency and rate
- Respects provided AbortSignal before queueing and after dequeueing; if
  aborted, a `RequestAbortedError` is thrown so callers can detect aborts

Usage:

```typescript
const geocoder = new Throttler(
  new OpenStreetMap(config),
  { concurrency: 1, intervalCap: 1000 }
);

// Throttler can be used with LocationIQ as well
import { LocationIQ } from '../../LocationIQ.js';
const li = new LocationIQ({ apiKey: process.env.LOCATIONIQ_KEY, concurrency: 1 });
const throttled = new Throttler(li, { concurrency: 1, intervalCap: 1000 });
```

### Fallback

Chains multiple geocoders, falling back on failure or null results.

Usage:

```typescript
const geocoder = new Fallback(
  new OpenStreetMap(config),
  new Photon(config)
);
```

### LoadBalancer

Distributes requests across multiple geocoder instances.

Key behaviors:

- Selects the provider with the lowest (size + pending) load
- Wraps providers with `Fallback` so a failed provider falls back to
  alternative providers
- Emits lightweight debug events on PQueue

Usage:

```typescript
const geocoder = new LoadBalancer([
  new OpenStreetMap(config1),
  new OpenStreetMap(config2)
]);
```

## Composition

Decorators can be composed together:

```typescript
const geocoder = new Cache(
  new LoadBalancer([
    new Fallback(osm1, photon1),
    new Fallback(osm2, photon2)
  ]),
  { size: 1000 }
);
```

This creates a cached, load-balanced geocoder with fallback providers.
