import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('Rate Limiting', () => {
  const apps: Array<ReturnType<typeof createApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('should block requests after rate limit exceeded', async () => {
    // Disable helmet in tests to avoid fastify-plugin version mismatch
    const mockGeocoder = {
      search: async (q: string) => null
    };

    const app = createApp({
      geocoder: mockGeocoder,
      rateLimit: { max: 5, timeWindow: '1 minute' },
      helmet: { enabled: false }
    });
    apps.push(app);

    // Make 5 requests at the limit
    const reqs = Array.from({ length: 5 }, () =>
      app.inject({ method: 'GET', url: '/search?q=test' })
    );
    await Promise.all(reqs);

    // 6th request should be rate limited
    const res = await app.inject({ method: 'GET', url: '/search?q=test' });
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body).toHaveProperty('error', 'Too Many Requests');
    expect(body).toHaveProperty('message');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('uses Fastify request identity instead of a spoofed forwarded header', async () => {
    const app = createApp({
      geocoder: { search: async () => null },
      rateLimit: { max: 1, timeWindow: '1 minute' },
      helmet: { enabled: false }
    });
    apps.push(app);

    const first = await app.inject({
      method: 'GET',
      url: '/search?q=test',
      headers: { 'x-forwarded-for': 'attacker-a' }
    });
    const second = await app.inject({
      method: 'GET',
      url: '/search?q=test',
      headers: { 'x-forwarded-for': 'attacker-b' }
    });

    expect(first.statusCode).toBe(404);
    expect(second.statusCode).toBe(429);
  });

  it('uses the forwarded client identity only when trusted proxy mode is enabled', async () => {
    const app = createApp({
      geocoder: { search: async () => null },
      trustProxy: true,
      rateLimit: { max: 1, timeWindow: '1 minute' },
      helmet: { enabled: false }
    });
    apps.push(app);

    const first = await app.inject({
      url: '/search?q=test',
      headers: { 'x-forwarded-for': 'client-a' }
    });
    const second = await app.inject({
      url: '/search?q=test',
      headers: { 'x-forwarded-for': 'client-b' }
    });

    expect(first.statusCode).toBe(404);
    expect(second.statusCode).toBe(404);
  });

  it('exempts only liveness from an exhausted rate limit', async () => {
    const app = createApp({
      geocoder: { search: async () => null },
      rateLimit: { max: 1, timeWindow: '1 minute' },
      helmet: { enabled: false }
    });
    apps.push(app);

    expect((await app.inject('/search?q=test')).statusCode).toBe(404);
    expect((await app.inject('/search?q=test')).statusCode).toBe(429);
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect((await app.inject('/health')).statusCode).toBe(429);
    expect((await app.inject('/health/ready')).statusCode).toBe(429);
  });

  it('expires entries after the configured window', async () => {
    const app = createApp({
      geocoder: { search: async () => null },
      rateLimit: { max: 1, timeWindow: '10ms' },
      helmet: { enabled: false }
    });
    apps.push(app);

    expect((await app.inject('/search?q=test')).statusCode).toBe(404);
    expect((await app.inject('/search?q=test')).statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await app.inject('/search?q=test')).statusCode).toBe(404);
  });

  it('evicts the oldest key when the bounded store is full', async () => {
    const app = createApp({
      geocoder: { search: async () => null },
      rateLimit: { max: 1, maxKeys: 1, timeWindow: '1 minute' },
      helmet: { enabled: false }
    });
    apps.push(app);

    expect(
      (await app.inject({ method: 'GET', url: '/search?q=test', remoteAddress: '10.0.0.1' }))
        .statusCode
    ).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(
      (await app.inject({ method: 'GET', url: '/search?q=test', remoteAddress: '10.0.0.2' }))
        .statusCode
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/search?q=test', remoteAddress: '10.0.0.1' }))
        .statusCode
    ).toBe(404);
  });

  it('rejects invalid limiter settings and unsupported Redis configuration', () => {
    expect(() =>
      createApp({ geocoder: { search: async () => null }, rateLimit: { max: 0 } })
    ).toThrow();
    expect(() =>
      createApp({ geocoder: { search: async () => null }, rateLimit: { timeWindow: 'forever' } })
    ).toThrow();
    expect(() =>
      createApp({
        geocoder: { search: async () => null },
        rateLimit: { redis: 'redis://localhost' }
      })
    ).toThrow('Redis support');
  });
});
