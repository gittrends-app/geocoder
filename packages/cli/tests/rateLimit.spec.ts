import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('Rate Limiting', () => {
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
  });
});
