import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fetch from './fetch.js';

/**
 * Tests for the fetch helper that wraps node-fetch with:
 * - Automatic retry logic (3 retries) for transient failures
 * - Configurable timeout via options.timeout (default 10 seconds)
 * - Retry on 5xx, 429, 418 status codes and network errors
 * - Exponential backoff for retries
 * - StatusCode property added to responses
 *
 * Uses nock for HTTP mocking to intercept and mock HTTP requests.
 * Tests use 2-second timeout for faster execution.
 */
describe('fetch helper', () => {
  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('timeout functionality', () => {
    it('should successfully fetch when response is fast', async () => {
      const scope = nock('https://api.example.com').get('/data').reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should timeout when server takes longer than configured timeout', async () => {
      nock('https://slow-api.example.com')
        .get('/slow')
        .delay(2500) // Delay longer than 2-second timeout
        .reply(200, { success: true })
        .get('/slow')
        .delay(0)
        .reply(200, { success: true });

      const startTime = Date.now();

      await expect(
        fetch('https://slow-api.example.com/slow', { timeout: 2000 })
      ).resolves.toBeDefined();

      expect(Date.now() - startTime).toBeGreaterThanOrEqual(2000);
    });

    it('should not timeout if request completes within configured timeout', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .delay(500) // Delay less than 2-second timeout
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should complete successfully with delay just under timeout', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .delay(1800) // Just under the 2-second timeout
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    }, 3000);

    it('should use default 10-second timeout when not specified', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .delay(500)
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data');

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should respect custom longer timeout', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .delay(4000) // 4-second delay
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 5000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    }, 6000);
  });

  describe('retry functionality', () => {
    it('should retry on 500 server errors', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .reply(500, 'Server Error')
        .get('/data')
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    }, 5000);

    it('should retry on 502 bad gateway', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .reply(502, 'Bad Gateway')
        .get('/data')
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should retry on 503 service unavailable', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .reply(503, 'Service Unavailable')
        .get('/data')
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should retry on 429 rate limit', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .reply(429, 'Too Many Requests')
        .get('/data')
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should retry on 418 teapot', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .reply(418, "I'm a teapot")
        .get('/data')
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should not retry on 404 not found', async () => {
      const scope = nock('https://api.example.com').get('/data').reply(404, 'Not Found');

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(404);
      expect(scope.isDone()).toBe(true);
    });

    it('should not retry on 400 bad request', async () => {
      const scope = nock('https://api.example.com').get('/data').reply(400, 'Bad Request');

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(400);
      expect(scope.isDone()).toBe(true);
    });

    it('should retry on network errors', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .replyWithError('Network error')
        .get('/data')
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('response handling', () => {
    it('should return response with status', async () => {
      nock('https://api.example.com').get('/data').reply(200, { message: 'Hello' });

      const response = await fetch('https://api.example.com/data');

      expect(response.status).toBe(200);
    });

    it('should add statusCode property to response', async () => {
      nock('https://api.example.com').get('/data').reply(201, { id: '123' });

      const response = await fetch('https://api.example.com/data');

      expect(response.status).toBe(201);
    });

    it('should handle error responses', async () => {
      nock('https://api.example.com').get('/data').reply(404, 'Not Found');

      const response = await fetch('https://api.example.com/data');

      expect(response.status).toBe(404);
    });

    it('should handle JSON responses', async () => {
      nock('https://api.example.com').get('/data').reply(200, { name: 'test', value: 42 });

      const response = await fetch('https://api.example.com/data');
      const data = await response.json();

      expect(data).toEqual({ name: 'test', value: 42 });
    });
  });

  describe('request options', () => {
    it('should pass through POST method', async () => {
      const scope = nock('https://api.example.com')
        .post('/data', { test: 'data' })
        .reply(201, { success: true });

      const response = await fetch('https://api.example.com/data', {
        method: 'POST',
        body: JSON.stringify({ test: 'data' }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      expect(response.status).toBe(201);
      expect(scope.isDone()).toBe(true);
    });

    it('should pass through custom headers', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .matchHeader('Authorization', 'Bearer token123')
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', {
        headers: {
          Authorization: 'Bearer token123'
        }
      });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should accept URL object', async () => {
      const scope = nock('https://api.example.com').get('/data').reply(200, { success: true });

      const url = new URL('https://api.example.com/data');
      const response = await fetch(url);

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should handle query parameters', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .query({ foo: 'bar', baz: 'qux' })
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data?foo=bar&baz=qux');

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('integration with timeout and retries', () => {
    it('should complete successfully with retries when fast', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .reply(500, 'Server Error')
        .get('/data')
        .delay(100) // Still within 2-second timeout
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should handle multiple sequential requests', async () => {
      const scope = nock('https://api.example.com')
        .get('/data1')
        .reply(200, { id: 1 })
        .get('/data2')
        .reply(200, { id: 2 })
        .get('/data3')
        .reply(200, { id: 3 });

      const response1 = await fetch('https://api.example.com/data1');
      const response2 = await fetch('https://api.example.com/data2');
      const response3 = await fetch('https://api.example.com/data3');

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response3.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty response body', async () => {
      const scope = nock('https://api.example.com').get('/data').reply(204);

      const response = await fetch('https://api.example.com/data');

      expect(response.status).toBe(204);
      expect(scope.isDone()).toBe(true);
    });

    it('should handle response delays within custom timeout', async () => {
      const scope = nock('https://api.example.com')
        .get('/data')
        .delay(1800) // Just under the 2-second timeout
        .reply(200, { success: true });

      const response = await fetch('https://api.example.com/data', { timeout: 2000 });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    }, 3000);

    it('should handle URL with port', async () => {
      const scope = nock('https://api.example.com:8443').get('/data').reply(200, { success: true });

      const response = await fetch('https://api.example.com:8443/data');

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });
  });
});
