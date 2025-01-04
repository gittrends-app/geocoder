import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';
import { Cache } from './Cache.js';

describe('Cache', () => {
  const mockGeocoder = {
    search: vi.fn()
  } as unknown as Geocoder;

  let cache: Cache;

  const cachedAddress: Address = {
    source: '123 Main St',
    confidence: 1,
    name: '123 Main St',
    type: 'any'
  };

  beforeEach(() => {
    cache = new Cache(mockGeocoder, {
      size: 100,
      ttl: 60,
      namespace: 'test'
    });
  });

  it('should return cached address if available', async () => {
    vi.spyOn(cache['cache'], 'get').mockResolvedValueOnce(cachedAddress);

    const result = await cache.search(cachedAddress.source);

    expect(result).toEqual(cachedAddress);
    expect(mockGeocoder.search).not.toHaveBeenCalled();
  });

  it('should fetch address if not cached and cache the result', async () => {
    (mockGeocoder.search as Mock).mockResolvedValueOnce(cachedAddress);
    const setSpy = vi.spyOn(cache['cache'], 'set').mockResolvedValueOnce(undefined);

    const result = await cache.search(cachedAddress.source);

    expect(result).toEqual(cachedAddress);
    expect(mockGeocoder.search).toHaveBeenCalledWith(cachedAddress.source, undefined);
    expect(setSpy).toHaveBeenCalledWith(cachedAddress.source, cachedAddress);
  });

  it('should cache false if no address is found', async () => {
    (mockGeocoder.search as Mock).mockResolvedValueOnce(null);
    const setSpy = vi.spyOn(cache['cache'], 'set').mockResolvedValueOnce(undefined);

    const result = await cache.search(cachedAddress.source);

    expect(result).toBeNull();
    expect(setSpy).toHaveBeenCalledWith(cachedAddress.source, false);
  });
});
