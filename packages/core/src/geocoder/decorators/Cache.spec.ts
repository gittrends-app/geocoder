import { describe, expect, it, vi } from 'vitest';
import { Address } from '../../entities/Address.js';
import { RequestAbortedError } from '../../errors/index.js';
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

  it('should return null for a later negative cache hit', async () => {
    const mockSearch = vi.fn().mockResolvedValue(null);
    const geocoder = { search: mockSearch } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });

    expect(await cache.search('  No   Such   Place ')).toBeNull();
    // Cache writes are intentionally non-blocking.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await cache.search('No Such Place')).toBeNull();
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('should use the canonical query as the provider source', async () => {
    const mockSearch = vi.fn(async (query: string) => ({ source: query }) as unknown as Address);
    const geocoder = { search: mockSearch } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });

    const result = await cache.search('  Same\tQuery  ');

    expect(result?.source).toBe('Same Query');
    expect(mockSearch).toHaveBeenCalledWith('Same Query', expect.anything());
  });

  it('should abort while waiting for cache lookup and clean up its listener', async () => {
    let rejectCacheLookup: (error: Error) => void = () => undefined;
    const cacheLookup = new Promise<undefined>((_, reject) => {
      rejectCacheLookup = reject;
    });
    const geocoder = { search: vi.fn() } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });
    const store = (cache as any).cache as { get: () => Promise<undefined> };
    store.get = vi.fn(() => cacheLookup);
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    const request = cache.search('slow cache', { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toBeInstanceOf(RequestAbortedError);
    rejectCacheLookup(new Error('late cache failure'));

    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('should abort one caller without cancelling a shared request for another', async () => {
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    let resolveProvider!: (address: Address) => void;
    let underlyingAborted = false;
    const mockSearch = vi.fn((_query: string, options?: { signal?: AbortSignal }) => {
      requestStarted();
      return new Promise<Address>((resolve, reject) => {
        resolveProvider = resolve;
        options?.signal?.addEventListener(
          'abort',
          () => {
            underlyingAborted = true;
            reject(new RequestAbortedError(_query));
          },
          { once: true }
        );
      });
    });
    const geocoder = { search: mockSearch } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });
    const firstController = new AbortController();

    const first = cache.search('same query', { signal: firstController.signal });
    await started;
    const second = cache.search(' same   query ');
    await vi.waitFor(() => {
      const pending = (cache as any).pending.get('same query');
      expect(pending?.callers).toBe(2);
    });
    firstController.abort();

    await expect(first).rejects.toBeInstanceOf(RequestAbortedError);
    expect(underlyingAborted).toBe(false);
    resolveProvider({ provider: 'openstreetmap' } as unknown as Address);
    await expect(second).resolves.toEqual({ provider: 'openstreetmap' });
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('cancels the shared provider request when all callers abort', async () => {
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    let underlyingAborted = false;
    const mockSearch = vi.fn((_query: string, options?: { signal?: AbortSignal }) => {
      requestStarted();
      return new Promise<Address>((_, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            underlyingAborted = true;
            reject(new RequestAbortedError(_query));
          },
          { once: true }
        );
      });
    });
    const geocoder = { search: mockSearch } as unknown as Geocoder;
    const cache = new Cache(geocoder, { size: 100, ttl: 60 });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = cache.search('all abort', { signal: firstController.signal });
    await started;
    const second = cache.search(' all   abort ', { signal: secondController.signal });
    await vi.waitFor(() => {
      const pending = (cache as any).pending.get('all abort');
      expect(pending?.callers).toBe(2);
    });

    firstController.abort();
    secondController.abort();

    await expect(first).rejects.toBeInstanceOf(RequestAbortedError);
    await expect(second).rejects.toBeInstanceOf(RequestAbortedError);
    expect(underlyingAborted).toBe(true);
    expect(mockSearch).toHaveBeenCalledTimes(1);
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

  it('expires positive and negative entries using their configured TTLs', async () => {
    const address = {
      provider: 'photon',
      source: 'Positive',
      name: 'Positive',
      type: 'city',
      confidence: 0
    } as Address;
    const positiveSearch = vi.fn().mockResolvedValue(address);
    const positiveCache = new Cache({ search: positiveSearch } as unknown as Geocoder, {
      positiveTtl: 20
    });

    await positiveCache.search('Positive');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await positiveCache.search('Positive');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await positiveCache.search('Positive');
    expect(positiveSearch).toHaveBeenCalledTimes(2);

    const negativeSearch = vi.fn().mockResolvedValue(null);
    const negativeCache = new Cache({ search: negativeSearch } as unknown as Geocoder, {
      negativeTtl: 20
    });
    await negativeCache.search('Negative');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await negativeCache.search('Negative');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await negativeCache.search('Negative');
    expect(negativeSearch).toHaveBeenCalledTimes(2);
  });

  it('discards cached values that do not satisfy AddressSchema', async () => {
    const search = vi.fn().mockResolvedValue({
      provider: 'photon',
      source: 'stale',
      name: 'Fresh',
      type: 'city',
      confidence: 0
    } as Address);
    const cache = new Cache({ search } as unknown as Geocoder);
    await (cache as any).cache.set('stale', { source: 'stale', name: 'invalid' });

    await expect(cache.search('stale')).resolves.toMatchObject({ name: 'Fresh' });
    expect(search).toHaveBeenCalledOnce();
  });

  it('uses a distinct namespace for each effective provider configuration', async () => {
    const first = { provider: 'photon', source: 'same', name: 'First', confidence: 0 } as Address;
    const second = { provider: 'photon', source: 'same', name: 'Second', confidence: 0 } as Address;
    const firstSearch = vi.fn().mockResolvedValue(first);
    const secondSearch = vi.fn().mockResolvedValue(second);
    const config = {
      schema: 1,
      provider: 'photon',
      endpoint: 'https://one.example',
      language: 'en'
    };
    const firstCache = new Cache({ search: firstSearch } as unknown as Geocoder, {
      namespace: 'cli',
      config
    });
    const secondCache = new Cache({ search: secondSearch } as unknown as Geocoder, {
      namespace: 'cli',
      config: { ...config, endpoint: 'https://two.example' }
    });

    await expect(firstCache.search('same')).resolves.toMatchObject({ name: 'First' });
    await expect(secondCache.search('same')).resolves.toMatchObject({ name: 'Second' });
    expect(firstSearch).toHaveBeenCalledOnce();
    expect(secondSearch).toHaveBeenCalledOnce();
  });
});
