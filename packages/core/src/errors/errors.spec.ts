import { describe, expect, it } from 'vitest';
import {
  CacheError,
  GeocoderError,
  NoProvidersError,
  QueueFullError,
  RateLimitError,
  RequestAbortedError,
  ValidationError
} from './index.js';

describe('Errors', () => {
  it('should instantiate GeocoderError and preserve message', () => {
    const e = new GeocoderError('oops');
    expect(e.message).toBe('oops');
    expect(e.name).toBe('GeocoderError');
  });

  it('should include query in RequestAbortedError', () => {
    const e = new RequestAbortedError('test');
    expect(e.message).toContain('test');
    expect(e.name).toBe('RequestAbortedError');
  });

  it('should create RateLimitError with provider', () => {
    const e = new RateLimitError('osm', 30);
    expect(e.provider).toBe('osm');
    expect(e.retryAfter).toBe(30);
  });

  it('should create ValidationError with field details', () => {
    const e = new ValidationError('email', 'x', 'invalid format');
    expect(e.field).toBe('email');
  });

  it('should create CacheError wrapping a cause', () => {
    const cause = new Error('io');
    const e = new CacheError('read', cause);
    expect(e.cause).toBe(cause);
  });

  it('should create NoProvidersError', () => {
    const e = new NoProvidersError();
    expect(e.message).toContain('No geocoder providers');
  });
});
