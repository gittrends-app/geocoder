import { describe, expect, it, vi } from 'vitest';
import { Address } from '../../entities/Address.js';
import type { Geocoder } from '../Geocoder.js';
import { Cache } from './Cache.js';

describe('Cache decorator - deduplication and non-blocking writes', () => {
  it('should deduplicate concurrent requests and call underlying search once', async () => {
    const cachedAddress = {
      provider: 'openstreetmap',
      source: 'San Francisco',
      name: 'San Francisco, CA, USA',
      type: 'city',
      confidence: 0.9
    } as unknown as Address;

    // Delayed resolver to simulate in-flight request
    const mockSearch = vi.fn(
      () => new Promise<Address>((res) => setTimeout(() => res(cachedAddress), 50))
    );

    const geocoder = { search: mockSearch } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });

    const promises = Array.from({ length: 10 }, () => cache.search('San Francisco'));
    const results = await Promise.all(promises);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
    expect(results.every((r) => r === cachedAddress)).toBe(true);
  });

  it('should deduplicate concurrent negative (null) results and return null to callers', async () => {
    const mockSearch = vi.fn(() => new Promise<null>((res) => setTimeout(() => res(null), 50)));

    const geocoder = { search: mockSearch } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });

    const promises = Array.from({ length: 5 }, () => cache.search('Nowhere'));
    const results = await Promise.all(promises);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === null)).toBe(true);
  });

  it('should clean up pending map after rejection', async () => {
    const mockSearch = vi.fn(
      () => new Promise((_res, rej) => setTimeout(() => rej(new Error('boom')), 20))
    );

    const geocoder = { search: mockSearch } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });

    const p1 = cache.search('Fail');
    const p2 = cache.search('Fail');

    await expect(Promise.all([p1, p2])).rejects.toBeDefined();

    // Access internal pending map to ensure cleanup (runtime check)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = (cache as any).pending as Map<string, Promise<Address | null>>;
    expect(pending.size).toBe(0);
  });
});
