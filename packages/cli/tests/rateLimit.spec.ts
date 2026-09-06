import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('Rate Limiting', () => {
  const apps: Array<ReturnType<typeof createApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('should block requests after rate limit exceeded', async () => {
    const mockGeocoder = {
      search: async (q: string) => null
    };

    const app = createApp({
      geocoder: mockGeocoder,
      rateLimit: { max: 5, timeWindow: '1 minute' }
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
      rateLimit: { max: 1, timeWindow: '1 minute' }
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
      rateLimit: { max: 1, timeWindow: '1 minute' }
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

  it('applies the rate limit to health checks', async () => {
    const app = createApp({
      geocoder: { search: async () => null },
      rateLimit: { max: 1, timeWindow: '1 minute' }
    });
    apps.push(app);

    expect((await app.inject('/search?q=test')).statusCode).toBe(404);
    expect((await app.inject('/search?q=test')).statusCode).toBe(429);
    expect((await app.inject('/health')).statusCode).toBe(429);
  });

  it('expires entries after the configured window', async () => {
    const app = createApp({
      geocoder: { search: async () => null },
      rateLimit: { max: 1, timeWindow: '10ms' }
    });
    apps.push(app);

    expect((await app.inject('/search?q=test')).statusCode).toBe(404);
    expect((await app.inject('/search?q=test')).statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await app.inject('/search?q=test')).statusCode).toBe(404);
  });

  it('rejects invalid limiter settings', () => {
    expect(() =>
      createApp({ geocoder: { search: async () => null }, rateLimit: { max: 0 } })
    ).toThrow();
    expect(() =>
      createApp({ geocoder: { search: async () => null }, rateLimit: { timeWindow: 'forever' } })
    ).toThrow();
  });
});
