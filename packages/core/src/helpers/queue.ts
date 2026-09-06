import type { ThrottlerOptions } from '../geocoder/decorators/Throttler.js';

type RateOptions = Omit<ThrottlerOptions, 'retries' | 'retryDelay'>;

export function queueOptions(rate: RateOptions | undefined, concurrency?: number): RateOptions {
  return rate
    ? { ...rate, concurrency: rate.concurrency ?? concurrency ?? 1 }
    : { concurrency: concurrency ?? 1, intervalCap: 1, interval: 1000, strict: true };
}