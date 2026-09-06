import Debug from 'debug';
import PQueue from 'p-queue';
import { Address } from '../../entities/Address.js';
import { ProviderError, RequestAbortedError } from '../../errors/index.js';
import { normalizeQueryWithOriginal } from '../../helpers/query.js';
import { Geocoder } from '../Geocoder.js';
import { Decorator } from './Decorator.js';

const debug = Debug('geocoder:throttler');

export type ThrottlerOptions = NonNullable<ConstructorParameters<typeof PQueue>[0]> & {
  retries?: number;
  retryDelay?: number;
};

/**
 * Throttler is a decorator that limits the rate of requests to the geocoder.
 */
export class Throttler extends Decorator {
  private queue;

  /**
   * Constructor
   * @param geocoder - Geocoder service
   */
  constructor(geocoder: Geocoder, options: ThrottlerOptions) {
    super(geocoder);
    const { retries: _retries, retryDelay: _retryDelay, ...queueOptions } = options;
    this.retries = nonNegativeInteger(_retries ?? 0, 'retries');
    this.retryDelay = nonNegativeNumber(_retryDelay ?? 0, 'retryDelay');
    this.queue = new PQueue(queueOptions);
    debug(
      'initialized with concurrency=%d, intervalCap=%d',
      options.concurrency,
      options.intervalCap
    );
  }

  private readonly retries: number;
  private readonly retryDelay: number;

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized } = normalizeQueryWithOriginal(q);
    debug(
      'queueing search for: %s (queue size: %d, pending: %d)',
      normalized,
      this.queue.size,
      this.queue.pending
    );
    // Respect abort before queueing
    if (options?.signal?.aborted) {
      debug('request aborted before queueing: %s', normalized);
      throw new RequestAbortedError(normalized);
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        return (await this.queue.add(() => {
          // Check again when dequeued
          if (options?.signal?.aborted) {
            debug('request aborted after dequeue: %s', normalized);
            throw new RequestAbortedError(normalized);
          }
          return this.geocoder.search(normalized, options);
        }, options)) as Address | null;
      } catch (error) {
        // p-queue rejects a task removed by its signal with its own AbortError.
        // Keep the public error contract independent of the queue implementation.
        if (options?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw new RequestAbortedError(normalized);
        }
        if (!this.canRetry(error, attempt, options?.signal)) throw error;
        const retryAfter = error instanceof ProviderError ? error.retryAfter : undefined;
        await this.wait((retryAfter ?? this.retryDelay / 1000) * 1000, options?.signal, normalized);
      }
    }
  }

  private canRetry(error: unknown, attempt: number, signal?: AbortSignal): boolean {
    if (signal?.aborted || attempt >= this.retries) return false;
    return (
      (error instanceof ProviderError && error.retryable) ||
      (error instanceof Error && (error as Error & { retryable?: boolean }).retryable === true)
    );
  }

  private wait(ms: number, signal: AbortSignal | undefined, query: string): Promise<void> {
    if (signal?.aborted) return Promise.reject(new RequestAbortedError(query));
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new RequestAbortedError(query));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}
