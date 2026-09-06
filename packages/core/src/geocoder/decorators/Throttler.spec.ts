import { describe, expect, it, vi } from 'vitest';
import { ProviderError, RequestAbortedError } from '../../errors/index.js';
import type { Geocoder } from '../Geocoder.js';
import { Cache } from './Cache.js';
import { Throttler } from './Throttler.js';

describe('Throttler', () => {
  it('applies strict interval policy between task starts', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const geocoder = {
        search: vi.fn(async (query: string) => {
          calls.push(query);
          return null;
        })
      } as unknown as Geocoder;
      const throttler = new Throttler(geocoder, {
        concurrency: 2,
        intervalCap: 1,
        interval: 100,
        strict: true
      });

      const first = throttler.search('first');
      const second = throttler.search('second');
      await Promise.resolve();
      await Promise.resolve();
      expect(calls).toEqual(['first']);
      await vi.advanceTimersByTimeAsync(99);
      expect(calls).toEqual(['first']);
      await vi.advanceTimersByTimeAsync(1);
      await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
      expect(calls).toEqual(['first', 'second']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes queued aborts to RequestAbortedError', async () => {
    let release!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const geocoder = {
      search: vi
        .fn()
        .mockImplementationOnce(async () => {
          await firstStarted;
          return null;
        })
        .mockResolvedValue(null)
    } as unknown as Geocoder;
    const throttler = new Throttler(geocoder, { concurrency: 1 });
    const first = throttler.search('first');
    await vi.waitFor(() => expect(geocoder.search).toHaveBeenCalledOnce());
    const controller = new AbortController();
    const second = throttler.search('second', { signal: controller.signal });
    controller.abort();

    await expect(second).rejects.toBeInstanceOf(RequestAbortedError);
    release();
    await expect(first).resolves.toBeNull();
  });

  it.each([
    ['retries', -1],
    ['retries', 1.5],
    ['retryDelay', -1],
    ['retryDelay', Number.POSITIVE_INFINITY]
  ] as const)('rejects invalid %s values', (option, value) => {
    const geocoder = { search: vi.fn() } as unknown as Geocoder;
    expect(() => new Throttler(geocoder, { concurrency: 1, [option]: value })).toThrow(RangeError);
  });

  it('rejects an already aborted request before queueing', async () => {
    const geocoder = { search: vi.fn() } as unknown as Geocoder;
    const throttler = new Throttler(geocoder, { concurrency: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      throttler.search('  Paris  ', { signal: controller.signal })
    ).rejects.toMatchObject({
      name: 'RequestAbortedError',
      query: 'Paris'
    });
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it('waits for ProviderError retryAfter rather than retryDelay', async () => {
    vi.useFakeTimers();
    try {
      const error = new ProviderError('temporary', 'provider', 503, 'transient', 0.05);
      const geocoder = {
        search: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(null)
      } as unknown as Geocoder;
      const throttler = new Throttler(geocoder, {
        concurrency: 1,
        retries: 1,
        retryDelay: 1000
      });
      const request = throttler.search('Paris');
      await vi.advanceTimersByTimeAsync(0);
      expect(geocoder.search).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(49);
      expect(geocoder.search).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await expect(request).resolves.toBeNull();
      expect(geocoder.search).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to retryDelay when ProviderError has no retryAfter', async () => {
    vi.useFakeTimers();
    try {
      const error = new ProviderError('temporary', 'provider', 503, 'transient');
      const geocoder = {
        search: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(null)
      } as unknown as Geocoder;
      const throttler = new Throttler(geocoder, {
        concurrency: 1,
        retries: 1,
        retryDelay: 100
      });
      const request = throttler.search('Paris');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(99);
      expect(geocoder.search).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await expect(request).resolves.toBeNull();
      expect(geocoder.search).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['transient', 'rate-limit'] as const)('retries %s ProviderErrors', async (kind) => {
    const error = new ProviderError('temporary', 'provider', 503, kind);
    const geocoder = {
      search: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(null)
    } as unknown as Geocoder;
    const throttler = new Throttler(geocoder, { concurrency: 1, retries: 1 });

    await expect(throttler.search('Paris')).resolves.toBeNull();
    expect(geocoder.search).toHaveBeenCalledTimes(2);
  });

  it('rethrows the original retryable error after retries are exhausted', async () => {
    const error = new ProviderError('temporary', 'provider', 503, 'transient');
    const geocoder = { search: vi.fn().mockRejectedValue(error) } as unknown as Geocoder;
    const throttler = new Throttler(geocoder, { concurrency: 1, retries: 2 });

    await expect(throttler.search('Paris')).rejects.toBe(error);
    expect(geocoder.search).toHaveBeenCalledTimes(3);
  });

  it.each([new Error('failed'), new ProviderError('forbidden', 'provider', 403, 'authentication')])(
    'does not retry non-retryable errors',
    async (error) => {
      const geocoder = { search: vi.fn().mockRejectedValue(error) } as unknown as Geocoder;
      const throttler = new Throttler(geocoder, { concurrency: 1, retries: 2 });

      await expect(throttler.search('Paris')).rejects.toBe(error);
      expect(geocoder.search).toHaveBeenCalledOnce();
    }
  );

  it('retries an Error with an own retryable property', async () => {
    const error = Object.assign(new Error('temporary'), { retryable: true });
    const geocoder = {
      search: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(null)
    } as unknown as Geocoder;
    const throttler = new Throttler(geocoder, { concurrency: 1, retries: 1 });

    await expect(throttler.search('Paris')).resolves.toBeNull();
    expect(geocoder.search).toHaveBeenCalledTimes(2);
  });

  it('rejects a pending retry wait when its signal aborts and clears the timer', async () => {
    vi.useFakeTimers();
    try {
      const throttler = new Throttler({ search: vi.fn() } as unknown as Geocoder, {
        concurrency: 1
      });
      const controller = new AbortController();
      const wait = (
        throttler as unknown as {
          wait: (ms: number, signal: AbortSignal | undefined, query: string) => Promise<void>;
        }
      ).wait(100, controller.signal, 'Paris');

      controller.abort();
      await expect(wait).rejects.toBeInstanceOf(RequestAbortedError);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves a retry wait immediately for a non-positive delay', async () => {
    const throttler = new Throttler({ search: vi.fn() } as unknown as Geocoder, {
      concurrency: 1
    });
    const wait = (
      throttler as unknown as {
        wait: (ms: number, signal: AbortSignal | undefined, query: string) => Promise<void>;
      }
    ).wait(0, undefined, 'Paris');

    await expect(wait).resolves.toBeUndefined();
  });
});