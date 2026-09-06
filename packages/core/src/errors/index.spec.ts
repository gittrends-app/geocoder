import { describe, expect, it } from 'vitest';
import {
  CacheError,
  GeocoderError,
  NoProvidersError,
  ProviderError,
  QueueFullError,
  RateLimitError,
  RequestAbortedError,
  ValidationError
} from './index.js';

describe('geocoder errors', () => {
  it('stores the message, name, and optional cause', () => {
    const cause = new Error('root cause');
    const error = new GeocoderError('failed', cause);

    expect(error).toMatchObject({ name: 'GeocoderError', message: 'failed', cause });
    expect(error).toBeInstanceOf(Error);
  });

  it('stores ProviderError parameters and defaults', () => {
    expect(new ProviderError('failed')).toMatchObject({
      provider: 'unknown',
      status: undefined,
      kind: undefined,
      retryAfter: undefined
    });

    const cause = new Error('cause');
    const error = new ProviderError('failed', 'photon', 503, 'transient', 2, cause);
    expect(error).toMatchObject({
      name: 'ProviderError',
      provider: 'photon',
      status: 503,
      kind: 'transient',
      retryAfter: 2,
      cause
    });
  });

  it.each([
    ['rate-limit', true],
    ['transient', true],
    ['authentication', false],
    ['policy', false],
    ['invalid-request', false],
    [undefined, false]
  ] as const)('is retryable only for %s errors', (kind, retryable) => {
    expect(new ProviderError('failed', 'provider', undefined, kind).retryable).toBe(retryable);
  });

  it('formats aborted request errors with and without a query', () => {
    expect(new RequestAbortedError()).toMatchObject({
      name: 'RequestAbortedError',
      message: 'Geocoding request aborted',
      query: undefined
    });
    expect(new RequestAbortedError('Paris')).toMatchObject({
      message: 'Geocoding request aborted for query: Paris',
      query: 'Paris'
    });
  });

  it('formats rate limit errors and applies the status default', () => {
    expect(new RateLimitError('osm')).toMatchObject({
      name: 'RateLimitError',
      message: 'Rate limit exceeded for provider: osm',
      provider: 'osm',
      status: 429,
      retryAfter: undefined,
      kind: 'rate-limit'
    });
    expect(new RateLimitError('osm', 4, 418).status).toBe(418);
  });

  it('stores validation details', () => {
    expect(new ValidationError('query', 42, 'must be text')).toMatchObject({
      name: 'ValidationError',
      message: 'Validation failed for query: must be text',
      field: 'query',
      value: 42,
      constraint: 'must be text'
    });
  });

  it('formats cache and provider-pool errors', () => {
    const cause = new Error('store unavailable');
    expect(new CacheError('read', cause)).toMatchObject({
      name: 'CacheError',
      message: 'Cache read failed',
      cause
    });
    expect(new QueueFullError(7)).toMatchObject({
      name: 'QueueFullError',
      message: 'Queue is full: 7 items',
      queueSize: 7
    });
    expect(new NoProvidersError()).toMatchObject({
      name: 'NoProvidersError',
      message: 'No geocoder providers configured'
    });
  });
});