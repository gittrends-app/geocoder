import { describe, expect, it, vi } from 'vitest';
import { RequestAbortedError } from '../../errors/index.js';
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
});
