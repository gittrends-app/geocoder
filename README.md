# GitTrends Geocoder

`@gittrends-app/geocoder` is a Node.js library and CLI for turning free-form
place names into structured addresses. The CLI and core default to OpenStreetMap
Nominatim, Photon, and LocationIQ, with caching, fallback providers, and
request queues.

## Important: Nominatim usage policy

The default OSM provider is the public
[Nominatim service](https://nominatim.openstreetmap.org/). Its public-service
limit is **at most one request per second**. The official policy identifies
clients with a `User-Agent` or `Referer`; this implementation requires an
identifying `User-Agent` and contact email for that server. It sends the
former as the `User-Agent` header and the latter as the `email` query
parameter; it has no `Referer` option:

```bash
OSM_EMAIL=ops@example.com \
OSM_USER_AGENT='my-app/1.0 (https://example.com/contact)' \
gittrends-geocoder
```

For regular or long-running bulk work, Nominatim's policy also requires a
single-threaded, cached client and a maximum of **four requests per minute**.
Use one worker and keep caching enabled. The CLI bulk command rejects more than
one worker and paces public Nominatim work at four requests per minute.

Do not use the public service for autocomplete or systematic harvesting,
scraping place details, reselling geocoding data, or building a competing
database. Give visible OpenStreetMap/Nominatim attribution wherever results
are shown. Queries are sent to third-party providers, which may process or log
them: disclose those providers in your privacy notice and do not send personal
or confidential data unless applicable privacy law and provider terms permit
it.

The public endpoint and a self-hosted Nominatim instance are different
services. A custom `OSM_SERVER` is not automatically self-hosted or covered by
the public endpoint's capacity: use an instance you operate or a provider
whose terms permit your workload, and follow its limits. Switching providers
does not transfer the public Nominatim policy to another provider.

## Install

```bash
npm install github:gittrends-app/geocoder
# or
yarn add github:gittrends-app/geocoder
```

## Library usage

The public API method is `search`, not `geocode`:

```typescript
import { Cache, OpenStreetMap } from '@gittrends-app/geocoder';

const geocoder = new Cache(
  new OpenStreetMap({
    osmServer: 'https://nominatim.openstreetmap.org',
    email: process.env.OSM_EMAIL,
    userAgent: 'my-app/1.0 (https://example.com/contact)',
    concurrency: 1
  }),
  { size: 1000, positiveTtl: 3_600_000, negativeTtl: 300_000 }
);

const address = await geocoder.search('Brazil');
```

`Cache` TTLs are milliseconds; `0` means no expiry. It caches successful
results and not-found results separately, normalizes cache keys, and can use a
secondary Keyv store options. The CLI's persistent cache is a file named
`geocoder-cache.json` under `CACHE_DIR`; treat retained queries and results as
data that may need an expiry or deletion policy.

Results contain `source`, `name`, `type`, `confidence`, `provider`, and may
contain coordinates, a bounding box, and administrative fields. `score` is
the provider's score when available; it is **not a probability**. OSM uses
Nominatim `importance` for `confidence` and `score`, LocationIQ uses
`importance` or `rank_search`, and Photon reports `confidence: 0` without a
score. `minConfidence` filters OSM and LocationIQ results.

LocationIQ is configured in library code with a required constructor
`apiKey`; its options are `baseUrl`, `minConfidence`, `language`,
`concurrency`, `rate`, and `retries`. Library code does not read
`LOCATIONIQ_KEY`, `LOCATIONIQ_API_KEY`, `CACHE_DIR`, or cache TTL environment
variables. Those environment variables are CLI configuration only.

## CLI server

The executable is `gittrends-geocoder`. Running it without a subcommand starts
the HTTP server:

```bash
OSM_EMAIL=ops@example.com \
OSM_USER_AGENT='my-app/1.0 (https://example.com/contact)' \
gittrends-geocoder --host 0.0.0.0 --port 8080

curl 'http://localhost:8080/search?q=Brazil'
```

`GET /search?q=<place>` returns an address, or `404` when none is found. `q`
is normalized, must be non-empty, and is limited to 500 characters. `/docs`
serves Swagger UI and `/` redirects there. `/health`, `/health/ready`, and
`/health/live` are local process checks and never contact providers or consume
cache/provider capacity. They normally return `200`; `/health/live` also
bypasses the optional inbound rate limiter, while the other two can be
rate-limited. `/health` returns status, timestamp, and uptime; the other two
return `{ "ready": true }` and `{ "alive": true }`.

Successful searches also include `X-Geocoder-Provider` and, when available,
`X-Geocoder-Attribution` response headers. These headers do not replace
visible attribution in the consuming application.

### Server options

The server accepts these options:

```text
--osm-server <SERVER>       --osm-email <EMAIL>       --osm-agent <AGENT>
--providers <LIST>          --rate-profile <public|public-bulk|self-hosted>
--provider-language <LANG>  --provider-timeout-ms <MS>
--provider-retries <COUNT>  --locationiq-key <KEY>
--cache-dir <DIR>           --cache-size <SIZE>
--cache-positive-ttl <DURATION>  --cache-negative-ttl <DURATION>
--concurrency <COUNT>       --rate-limit
--rate-limit-max <MAX>      --rate-limit-window <DURATION>
--trust-proxy <BOOLEAN>     -H, --host <HOST>       -p, --port <PORT>
```

Providers are named `osm`, `photon`, and `locationiq`; `--providers` controls
their order. The first provider is tried first and later providers are used
for a null result or retryable provider failure. LocationIQ requires
`--locationiq-key` (or the CLI environment variable `LOCATIONIQ_KEY` or
`LOCATIONIQ_API_KEY`) when selected. There is no CLI option for a LocationIQ
base URL.

`--rate-profile` accepts `public`, `public-bulk`, or `self-hosted`. The CLI
identifies the public Nominatim server from `OSM_SERVER`; server mode applies
one request per second and bulk mode applies four requests per minute.
`self-hosted` should only describe an instance you operate; a custom server
still requires following that server's policy.

The CLI environment equivalents include `OSM_SERVER`, `OSM_EMAIL`,
`OSM_USER_AGENT`, `PROVIDERS`, `RATE_PROFILE`, `PROVIDER_LANGUAGE`,
`PROVIDER_TIMEOUT_MS`, `PROVIDER_RETRIES`, `LOCATIONIQ_KEY`,
`LOCATIONIQ_API_KEY`, `CACHE_DIR`, `CACHE_SIZE`,
`CACHE_POSITIVE_TTL_MS`, `CACHE_NEGATIVE_TTL_MS`, `CONCURRENCY`, `PORT`,
`HOST`, `LOG_LEVEL`, `RATE_LIMIT_ENABLED`, `RATE_LIMIT_MAX`,
`RATE_LIMIT_WINDOW`, `TRUST_PROXY`, and
`GRACEFUL_SHUTDOWN_TIMEOUT_MS`, and `NODE_ENV`. Durations accept values such as `500ms`,
`5 seconds`, or `1 hour`.

## Bulk command

Input is newline-delimited text from a positional file, `--input <FILE>`, or
stdin (the default; use `-` explicitly). Output is NDJSON on stdout and
progress is written to stderr:

```bash
OSM_EMAIL=ops@example.com \
OSM_USER_AGENT='my-app/1.0 (https://example.com/contact)' \
gittrends-geocoder bulk places.txt \
  --providers osm --workers 1 --cache-dir .cache \
  --cache-positive-ttl '24 hours' --resume previous.ndjson \
  --continue-on-error > results.ndjson
```

Bulk automatically uses the `public-bulk` profile for the public Nominatim
endpoint. Bulk options are `-i, --input <FILE>`, `--resume <FILE>`, `--workers <COUNT>`,
and `--continue`/`--continue-on-error`, plus the provider and cache options
listed above. Server-only options such as `--rate-limit`, `--trust-proxy`,
`--host`, and `--port` have no effect on `bulk`. Inputs are normalized and
deduplicated; successful queries in `--resume` are skipped. Each output line
is a success record such as `{ "query": "Paris", "ok": true, "address": null }`
(or an address object) or a failure record such as
`{ "query": "Paris", "ok": false, "error": "Geocoding failed" }`.

## Docker

Build and run from the repository root:

```bash
docker build -t gittrends/geocoder .
docker run --rm -p 8080:8080 gittrends/geocoder
```

The image listens on `0.0.0.0` port `8080` (unprivileged), runs with `NODE_ENV=production`, uses
`/app/.cache` as a volume, keeps up to 10,000 in-memory cache entries, and
uses provider concurrency `1`. Its image default `OSM_SERVER` is
`https://nominatim.geocoding.ai`, a hosted endpoint distinct from the official
public Nominatim service; verify that endpoint's terms or override it with
`-e OSM_SERVER=...`. If overriding it with the official public endpoint, also
provide `OSM_EMAIL` and `OSM_USER_AGENT`. No public Nominatim identity is
baked into the image. The CLI cache defaults are one hour for found results
and five minutes for not-found results.

The image runs as the unprivileged `node` user. Its health check uses
`/health/live`; this endpoint is independent of upstream provider health.

## Development

```bash
yarn install --frozen-lockfile
yarn verify
```

The project is MIT-licensed and available at
<https://github.com/gittrends-app/geocoder>.
