import Debug from 'debug';
import PQueue from 'p-queue';
import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';
import { Fallback } from './Fallback.js';

const debug = Debug('gittrends:geocoder:load-balancer');

/**
 * LoadBalancer decorator that distributes requests across multiple providers
 */
export class LoadBalancer implements Geocoder {
  private readonly providers: Array<{ geocoder: Geocoder; queue: PQueue }>;
  private readonly stats: { totalRequests: number; timeouts: number; queueFull: number };
  private readonly maxQueueSize: number;
  private readonly timeoutMs: number;

  /**
   * Create a new LoadBalancer
   * @param geocoders - Array of geocoder providers to distribute requests across
   */
  constructor(geocoders: Geocoder[], options?: { maxQueueSize?: number; timeoutMs?: number }) {
    if (!geocoders || geocoders.length === 0) {
      throw new Error('LoadBalancer requires at least one geocoder provider');
    }

    this.maxQueueSize =
      options?.maxQueueSize ??
      (process.env.LOADBALANCER_MAX_QUEUE_SIZE
        ? Number(process.env.LOADBALANCER_MAX_QUEUE_SIZE)
        : 1000);
    this.timeoutMs =
      options?.timeoutMs ??
      (process.env.LOADBALANCER_QUEUE_TIMEOUT_MS
        ? Number(process.env.LOADBALANCER_QUEUE_TIMEOUT_MS)
        : 30000);

    this.stats = { totalRequests: 0, timeouts: 0, queueFull: 0 };

    this.providers = geocoders.map((geocoder, index) => {
      const wrapped = geocoders
        .filter((_, i) => i !== index)
        .reduce((mem, geo) => new Fallback(mem, geo), geocoder);

      const queue = new PQueue({
        concurrency: Infinity,
        timeout: this.timeoutMs,
        autoStart: true
      });

      // Add lightweight event listeners for debugging
      // Note: PQueue emits 'active' and 'idle' events
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (queue as any).on?.('active', () => {
        debug('Provider %d active: %d pending', index, queue.pending);
      });

      (queue as any).on?.('idle', () => {
        debug('Provider %d idle', index);
      });

      // Handle queue errors (timeouts)
      (queue as any).on?.('error', (err: Error) => {
        debug('Provider %d queue error: %s', index, err?.message);
        if (err && err.message && err.message.includes('timeout')) this.stats.timeouts++;
      });

      return { geocoder: wrapped, queue };
    });

    debug('LoadBalancer initialized with %d providers', this.providers.length);
  }

  /**
   * Search for an address using the load balanced provider pool
   * Selects the provider with the lowest queue size for each request
   * @param q - Search query
   * @param options - Search options including optional AbortSignal
   * @returns Promise resolving to Address or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    this.stats.totalRequests++;
    // Select provider with lowest queue size
    const provider = this.providers.reduce((best, current) => {
      const bestLoad = best.queue.size + best.queue.pending;
      const currentLoad = current.queue.size + current.queue.pending;
      return currentLoad < bestLoad ? current : best;
    });

    const providerIndex = this.providers.indexOf(provider);
    debug(
      'Assigning request to provider %d: %s (queue size: %d, pending: %d)',
      providerIndex,
      q,
      provider.queue.size,
      provider.queue.pending
    );

    // Prevent unbounded growth: check queue size before enqueueing
    const currentLoad = provider.queue.size + provider.queue.pending;
    if (currentLoad >= this.maxQueueSize) {
      this.stats.queueFull++;
      const err = new Error(`Queue full: exceeded maximum size of ${this.maxQueueSize}`);
      debug('Provider %d queue full for request %s', providerIndex, q);
      throw err;
    }

    // Add to provider's queue
    try {
      return await provider.queue.add(() => provider.geocoder.search(q, options), options);
    } catch (err: unknown) {
      // Propagate queue timeouts/errors while incrementing stats where appropriate
      const e = err as Error;
      if (e && e.message && e.message.includes('timeout')) this.stats.timeouts++;
      throw err;
    }
  }

  getStats() {
    return {
      ...this.stats,
      providers: this.providers.map((p, i) => ({
        index: i,
        queueSize: p.queue.size,
        pending: p.queue.pending
      }))
    };
  }
}
