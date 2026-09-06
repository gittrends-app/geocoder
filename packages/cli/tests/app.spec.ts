import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type Address,
  GeocoderError,
  RateLimitError,
  RequestAbortedError,
  ValidationError
} from '../../core/src/index.js';
import { cacheIdentity, createApp, createGeocoder } from '../src/app.js';

const address = (source: string): Address => ({
  source,
  name: 'A Place',
  type: 'city',
  confidence: 0,
  country: 'France',
  city: 'Paris',
  provider: 'photon'
});

const makeApp = (search: (query: string) => Promise<Address | null>) =>
  createApp({ geocoder: { search } });

describe('HTTP application boundaries', () => {
  it('preserves address text and passes the canonical query to core', async () => {
    const search = vi.fn(async (query: string) => address(query));
    const app = makeApp(search);

    const response = await app.inject({
      method: 'GET',
      url: '/search?q=%20%C3%89cole%2C%20Rue%20de%20la%20Paix%20'
    });

    expect(response.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith('École, Rue de la Paix', expect.anything());
    expect(response.json().source).toBe('École, Rue de la Paix');
    await app.close();
  });

  it.each([
    ['/search?q=%20%20%20', 'Invalid request'],
    [`/search?q=${'x'.repeat(501)}`, 'Invalid request'],
    ['/search?q=valid%00query', 'Invalid request'],
    ['/search?q=valid%09query', 'Invalid request'],
    ['/search?q=valid%0Aquery', 'Invalid request'],
    ['/search?q=valid%0Dquery', 'Invalid request'],
    ['/search?q=one&q=two', 'Invalid request'],
    ['/search?q=valid&unexpected=value', 'Invalid request']
  ])('rejects invalid search input: %s', async (url, expectedMessage) => {
    const search = vi.fn(async (query: string) => address(query));
    const app = makeApp(search);

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain(expectedMessage);
    expect(search).not.toHaveBeenCalled();
    await app.close();
  });

  it('allows URL-like query text because URLSearchParams encodes it safely', async () => {
    const search = vi.fn(async (query: string) => address(query));
    const app = makeApp(search);

    const response = await app.inject({
      method: 'GET',
      url: '/search?q=https%3A%2F%2Fexample.test%2Fa%3Fb'
    });

    expect(response.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith('https://example.test/a?b', expect.anything());
    await app.close();
  });

  it.each([
    [new Error('provider secret'), 502, 'Geocoding service unavailable'],
    [new GeocoderError('upstream secret'), 502, 'Geocoding service unavailable'],
    [new ValidationError('q', 'bad', 'secret constraint'), 400, 'Invalid request'],
    [new RequestAbortedError('secret'), 499, 'Request aborted']
  ])('maps internal errors without exposing details', async (error, status, message) => {
    const app = makeApp(async () => {
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/search?q=valid' });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ message });
    expect(response.body).not.toContain('secret');
    await app.close();
  });

  it('propagates provider rate limits with Retry-After', async () => {
    const app = makeApp(async () => {
      throw new RateLimitError('openstreetmap', 12);
    });

    const response = await app.inject('/search?q=valid');

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('12');
    expect(response.json()).toEqual({ message: 'Geocoding service rate limited' });
    await app.close();
  });

  it('keeps health and readiness local without calling providers', async () => {
    const search = vi.fn(async () => {
      throw new Error('provider secret');
    });
    const app = createApp({
      geocoder: { search },
      cache: { size: 10 }
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).not.toHaveProperty('error');
    expect(health.json()).not.toHaveProperty('memory');
    expect(search).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not consume a cache or provider request for health checks', async () => {
    const search = vi.fn(async () => address('test'));
    const app = createApp({
      geocoder: { search },
      cache: { size: 10 }
    });

    expect((await app.inject('/health')).statusCode).toBe(200);
    expect(search).not.toHaveBeenCalled();
    await app.close();
  });

  it('exposes readiness and liveness health endpoints', async () => {
    const app = createApp({ geocoder: { search: async () => null } });

    expect((await app.inject('/health/ready')).json()).toEqual({ ready: true });
    expect((await app.inject('/health/live')).json()).toEqual({ alive: true });
    await app.close();
  });

  it('reports local health status without depending on provider results', async () => {
    const app = makeApp(async () => null);

    const health = await app.inject('/health');
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('healthy');
    await app.close();
  });

  it('adds provider metadata without changing the address response', async () => {
    const app = makeApp(async (query) => address(query));
    const response = await app.inject('/search?q=private%20query');

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-geocoder-provider']).toBe('photon');
    expect(response.headers['x-geocoder-attribution']).toContain('Photon');
    expect(response.json()).toMatchObject({ source: 'private query', provider: 'photon' });
    await app.close();
  });

  it('does not log the query or raw request URL', async () => {
    const app = createApp({
      geocoder: { search: async () => address('secret query') },
      logLevel: 'silent'
    });
    const logInfoSpy = vi.spyOn(app.log, 'info');

    await app.inject('/search?q=secret%20query&key=secret-api-key');

    const fields = JSON.stringify(logInfoSpy.mock.calls);
    expect(fields).not.toContain('secret query');
    expect(fields).not.toContain('secret-api-key');
    expect(fields).not.toContain('/search?q=');
    await app.close();
  });

  it('logs structured info when geocoding succeeds', async () => {
    const searchResult = address('São Paulo, Brazil');
    const search = vi.fn(async () => searchResult);
    const app = createApp({
      geocoder: { search },
      logLevel: 'silent'
    });

    const logInfoSpy = vi.spyOn(app.log, 'info');

    const response = await app.inject({
      method: 'GET',
      url: '/search?q=S%C3%A3o%20Paulo'
    });

    expect(response.statusCode).toBe(200);
    expect(logInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLength: 'São Paulo'.length,
        result: 'resolved',
        resolved: true,
        provider: 'photon',
        confidence: 0
      }),
      'geocoding completed'
    );
    expect(logInfoSpy.mock.calls[0]?.[0]).not.toHaveProperty('name');
    await app.close();
  });

  it('logs structured info when geocoding returns not found', async () => {
    const search = vi.fn(async () => null);
    const app = createApp({
      geocoder: { search },
      logLevel: 'silent'
    });

    const logInfoSpy = vi.spyOn(app.log, 'info');

    const response = await app.inject({
      method: 'GET',
      url: '/search?q=nonexistent123'
    });

    expect(response.statusCode).toBe(404);
    expect(logInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLength: 'nonexistent123'.length,
        result: 'not_found',
        resolved: false
      }),
      'geocoding completed'
    );
    // Verify that provider/name/confidence are NOT logged when result is null
    const callArg = logInfoSpy.mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty('provider');
    expect(callArg).not.toHaveProperty('name');
    expect(callArg).not.toHaveProperty('confidence');
    await app.close();
  });

  it('builds a public-bulk geocoder for the public Nominatim server without error', () => {
    const geocoder = createGeocoder({
      providers: ['osm'],
      rateProfile: 'public-bulk',
      concurrency: 2,
      email: 'ops@example.test',
      userAgent: 'test-agent/1.0'
    });

    expect(typeof geocoder.search).toBe('function');
  });

  it('derives a distinct cache identity when effective provider config changes', () => {
    const base = { providers: ['osm'], osmServer: 'https://one.example.test', language: 'en' };
    const changedLanguage = cacheIdentity({ ...base, language: 'fr' });
    const changedServer = cacheIdentity({ ...base, osmServer: 'https://two.example.test' });
    const same = cacheIdentity({ ...base });

    expect(cacheIdentity(base).schema).toBe('address-v2');
    expect(cacheIdentity(base)).toEqual(same);
    expect(cacheIdentity(base)).not.toEqual(changedLanguage);
    expect(cacheIdentity(base)).not.toEqual(changedServer);
  });

  it('persists cached results to the sqlite secondary store across app instances', async () => {
    const dirname = mkdtempSync(path.join(tmpdir(), 'geocoder-cache-'));
    try {
      const search = vi.fn(async (query: string) => address(query));
      const first = createApp({ geocoder: { search }, cache: { size: 10, dirname } });
      const firstResponse = await first.inject('/search?q=persisted');
      expect(firstResponse.statusCode).toBe(200);
      await first.close();
      // Give the fire-and-forget cache write a tick to flush to disk.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const second = createApp({ geocoder: { search }, cache: { size: 10, dirname } });
      const secondResponse = await second.inject('/search?q=persisted');
      expect(secondResponse.statusCode).toBe(200);
      await second.close();

      // A fresh in-memory LRU means a hit here only happens via the sqlite secondary store.
      expect(search).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dirname, { recursive: true, force: true });
    }
  });
});