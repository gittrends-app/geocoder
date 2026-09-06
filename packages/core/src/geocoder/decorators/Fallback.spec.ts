import { describe, expect, it, vi } from 'vitest';
import { Address } from '../../entities/Address.js';
import { ProviderError, RequestAbortedError } from '../../errors/index.js';
import { Geocoder } from '../Geocoder.js';
import { Fallback } from './Fallback.js';

describe('Fallback', () => {
  const mockAddress = {} as Address;

  it('should return address from primary geocoder', async () => {
    const primaryGeocoder = {
      search: vi.fn().mockResolvedValue(mockAddress)
    } as unknown as Geocoder;

    const fallbackGeocoder = {
      search: vi.fn()
    } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    const result = await fallback.search('query');

    expect(result).toBe(mockAddress);
    expect(primaryGeocoder.search).toHaveBeenCalledWith('query', undefined);
    expect(fallbackGeocoder.search).not.toHaveBeenCalled();
  });

  it('should return address from fallback geocoder if primary returns null', async () => {
    const primaryGeocoder = {
      search: vi.fn().mockResolvedValue(null)
    } as unknown as Geocoder;

    const fallbackGeocoder = {
      search: vi.fn().mockResolvedValue(mockAddress)
    } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    const result = await fallback.search('query');

    expect(result).toBe(mockAddress);
    expect(primaryGeocoder.search).toHaveBeenCalledWith('query', undefined);
    expect(fallbackGeocoder.search).toHaveBeenCalledWith('query', undefined);
  });

  it('should return null if both geocoders return null', async () => {
    const primaryGeocoder = {
      search: vi.fn().mockResolvedValue(null)
    } as unknown as Geocoder;

    const fallbackGeocoder = {
      search: vi.fn().mockResolvedValue(null)
    } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    const result = await fallback.search('query');

    expect(result).toBeNull();
    expect(primaryGeocoder.search).toHaveBeenCalledWith('query', undefined);
    expect(fallbackGeocoder.search).toHaveBeenCalledWith('query', undefined);
  });

  it('should not invoke fallback when the primary request is cancelled', async () => {
    const primaryGeocoder = {
      search: vi.fn().mockRejectedValue(new RequestAbortedError('query'))
    } as unknown as Geocoder;
    const fallbackGeocoder = { search: vi.fn() } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    await expect(fallback.search('query')).rejects.toBeInstanceOf(RequestAbortedError);
    expect(fallbackGeocoder.search).not.toHaveBeenCalled();
  });

  it('should not invoke fallback after the caller signal is aborted', async () => {
    const controller = new AbortController();
    const primaryGeocoder = {
      search: vi.fn().mockImplementation(async () => {
        controller.abort();
        return null;
      })
    } as unknown as Geocoder;
    const fallbackGeocoder = { search: vi.fn() } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    await expect(fallback.search('query', { signal: controller.signal })).rejects.toBeInstanceOf(
      RequestAbortedError
    );
    expect(fallbackGeocoder.search).not.toHaveBeenCalled();
  });

  it('should not invoke fallback a second time when the fallback rejects', async () => {
    const primaryGeocoder = { search: vi.fn().mockResolvedValue(null) } as unknown as Geocoder;
    const fallbackGeocoder = {
      search: vi.fn().mockRejectedValue(new Error('fallback failed'))
    } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    await expect(fallback.search('query')).rejects.toThrow('fallback failed');
    expect(fallbackGeocoder.search).toHaveBeenCalledTimes(1);
  });

  it('falls back for retryable provider errors but propagates policy errors', async () => {
    const fallbackGeocoder = {
      search: vi.fn().mockResolvedValue(mockAddress)
    } as unknown as Geocoder;
    const transient = new Fallback(
      {
        search: vi
          .fn()
          .mockRejectedValue(new ProviderError('transient', 'primary', undefined, 'transient'))
      } as unknown as Geocoder,
      fallbackGeocoder
    );

    await expect(transient.search('query')).resolves.toBe(mockAddress);
    expect(fallbackGeocoder.search).toHaveBeenCalledOnce();

    const policyFallback = { search: vi.fn() } as unknown as Geocoder;
    const policy = new Fallback(
      {
        search: vi.fn().mockRejectedValue(new ProviderError('policy', 'primary', 403, 'policy'))
      } as unknown as Geocoder,
      policyFallback
    );

    await expect(policy.search('query')).rejects.toMatchObject({ kind: 'policy' });
    expect(policyFallback.search).not.toHaveBeenCalled();
  });
});
