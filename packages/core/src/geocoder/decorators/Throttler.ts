import Debug from 'debug';
import PQueue from 'p-queue';
import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';
import { Decorator } from './Decorator.js';

const debug = Debug('geocoder:throttler');

/**
 * Throttler is a decorator that limits the rate of requests to the geocoder.
 */
export class Throttler extends Decorator {
  private queue;

  /**
   * Constructor
   * @param geocoder - Geocoder service
   */
  constructor(geocoder: Geocoder, options: NonNullable<ConstructorParameters<typeof PQueue>[0]>) {
    super(geocoder);
    this.queue = new PQueue(options);
    debug(
      'initialized with concurrency=%d, intervalCap=%d',
      options.concurrency,
      options.intervalCap
    );
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    debug(
      'queueing search for: %s (queue size: %d, pending: %d)',
      q,
      this.queue.size,
      this.queue.pending
    );
    // Respect abort before queueing
    if (options?.signal?.aborted) {
      debug('request aborted before queueing: %s', q);
      throw new Error('Request aborted');
    }

    return this.queue.add(() => {
      // Check again when dequeued
      if (options?.signal?.aborted) {
        debug('request aborted after dequeue: %s', q);
        throw new Error('Request aborted');
      }
      return this.geocoder.search(q, options);
    }, options) as Promise<Address | null>;
  }
}
