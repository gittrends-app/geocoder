import { describe, expect, it, vi } from 'vitest';
import {
  GeocoderError,
  RequestAbortedError,
  ValidationError,
  type Address
} from '../../core/src/index.js';
import { createApp } from '../src/app.js';

const address = (source: string): Address => ({
  source,
  name: 'A Place',
  type: 'city',
  confidence: 0,
  provider: 'photon'
});

const makeApp = (search: (query: string) => Promise<Address | null>) =>
  createApp({ geocoder: { search }, helmet: { enabled: false } });

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
    ['/search?q=%20%20%20', 'non-empty'],
    [`/search?q=${'x'.repeat(501)}`, 'Invalid request'],
    ['/search?q=valid%00query', 'control'],
    ['/search?q=valid%09query', 'control'],
    ['/search?q=valid%0Aquery', 'control'],
    ['/search?q=valid%0Dquery', 'control'],
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

    const response = await app.inject({ method: 'GET', url: '/search?q=https%3A%2F%2Fexample.test%2Fa%3Fb' });

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

  it('redacts health failures and bypasses the cache for readiness checks', async () => {
    const search = vi.fn(async () => {
      throw new Error('provider secret');
    });
    const app = createApp({
      geocoder: { search },
      cache: { size: 10 },
      helmet: { enabled: false }
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const readiness = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(health.statusCode).toBe(503);
    expect(health.json()).not.toHaveProperty('error');
    expect(health.json()).not.toHaveProperty('memory');
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toEqual({ ready: false });
    expect(search).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('uses the uncached geocoder for successful readiness checks', async () => {
    const search = vi.fn(async () => address('test'));
    const app = createApp({
      geocoder: { search },
      cache: { size: 10 },
      helmet: { enabled: false }
    });

    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    expect(search).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('reports a null health probe as degraded and unready', async () => {
    const app = makeApp(async () => null);

    const health = await app.inject('/health');
    const readiness = await app.inject('/health/ready');

    expect(health.statusCode).toBe(503);
    expect(health.json().status).toBe('degraded');
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toEqual({ ready: false });
    await app.close();
  });

  it('logs structured info when geocoding succeeds', async () => {
    const searchResult = address('São Paulo, Brazil');
    const search = vi.fn(async () => searchResult);
    const app = createApp({
      geocoder: { search },
      logLevel: 'silent',
      helmet: { enabled: false }
    });

    const logInfoSpy = vi.spyOn(app.log, 'info');

    const response = await app.inject({
      method: 'GET',
      url: '/search?q=S%C3%A3o%20Paulo'
    });

    expect(response.statusCode).toBe(200);
    expect(logInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'São Paulo',
        result: 'resolved',
        resolved: true,
        provider: 'photon',
        name: 'A Place',
        confidence: 0
      }),
      'geocoding completed'
    );
    await app.close();
  });

  it('logs structured info when geocoding returns not found', async () => {
    const search = vi.fn(async () => null);
    const app = createApp({
      geocoder: { search },
      logLevel: 'silent',
      helmet: { enabled: false }
    });

    const logInfoSpy = vi.spyOn(app.log, 'info');

    const response = await app.inject({
      method: 'GET',
      url: '/search?q=nonexistent123'
    });

    expect(response.statusCode).toBe(404);
    expect(logInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'nonexistent123',
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
});
