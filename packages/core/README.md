---
This `README.md` file provides an overview of the project and usage example.
---

# GitTrends Geocoder - core

GitTrends Geocoder is a geocoding service that uses OpenStreetMap and other services to provide geocoding functionality. It includes caching and request control mechanisms to improve its performance.

## Usage

Here is an example of how to use the GitTrends Geocoder with OpenStreetMap and caching:

```typescript
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import prettyformat from 'pretty-format';
import { Cache, OpenStreetMap } from '../src/index.js';

(async function main() {
  // Create a new instance of the OpenStreetMap service
  const openstreetmap = new OpenStreetMap({
    concurrency: 1,
    minConfidence: 0.5
  });

  // Create a cache decorator for the OpenStreetMap service (optional)
  // This decorator works as a proxy for the OpenStreetMap service caching previous results
  const service = new Cache(openstreetmap, {
    dirname: resolve(tmpdir(), 'addresses.json'),
    size: 1000,
    ttl: 0
  });

  // Some examples of addresses for testing

  let response = await service.search('Europe');
  console.log(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0.8778887201599463, "name": "Europe", "source": "Europe", "type": "continent"}

  response = await service.search('Earth planet');
  console.log(prettyformat.format(response, { min: true }));
  // output: null

  response = await service.search('Brazil');
  console.log(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0.8954966110329021, "country": "Brazil", "country_code": "BR", "name": "Brazil", "source": "Brazil", "type": "country"}

  response = await service.search('São Paulo, BR');
  console.log(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0.7446516338789693, "country": "Brazil", "country_code": "BR", "name": "Brazil, São Paulo", "source": "São Paulo, BR", "state": "São Paulo", "type": "municipality"}
})();
```

## API

### OpenStreetMap

The OpenStreetMap class provides geocoding functionality using the OpenStreetMap service.

```typescript
OpenStreetMap(options: { concurrency: number; minConfidence: number })
```

- `options.concurrency`: The number of concurrent requests allowed.
- `options.minConfidence`: The minimum confidence level required for a result.

### LocationIQ

The LocationIQ class provides geocoding functionality using the LocationIQ API. It requires an API key.

```typescript
LocationIQ(options: { apiKey: string; baseUrl?: string; concurrency?: number; minConfidence?: number })
```

- `options.apiKey`: Required. Your LocationIQ API key (can also be provided via env LOCATIONIQ_KEY).
- `options.baseUrl`: Optional. Custom LocationIQ base URL (default: https://us1.locationiq.com/v1).
- `options.concurrency`: Optional. Number of concurrent requests.
- `options.minConfidence`: Optional. Minimum confidence to accept a result.

Example:

```typescript
import { LocationIQ, Cache } from '../src/index.js';

const locationiq = new LocationIQ({ apiKey: process.env.LOCATIONIQ_KEY!, concurrency: 1, minConfidence: 0.5 });
const service = new Cache(locationiq, { dirname: '/tmp/addresses.json', size: 1000, ttl: 3600 });

const res = await service.search('Seattle');
console.log(res);
```

### Cache

The Cache class provides a caching mechanism for the geocoding service.

```typescript
Cache(service: OpenStreetMap, options: { dirname: string; size: number; ttl: number })
```

- `service`: The geocoding service to be cached.
- `options.dirname`: The directory name where the cache will be stored.
- `options.size`: The maximum size of the cache.
- `options.ttl`: The time-to-live for cache entries (in seconds).
