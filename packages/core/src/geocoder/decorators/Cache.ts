import { constants } from 'node:zlib';
import KeyvBrotli from '@keyv/compress-brotli';
import { Cache as CacheManager, CreateCacheOptions, createCache } from 'cache-manager';
import Debug from 'debug';
import Keyv, { KeyvOptions } from 'keyv';
import QuickLRU from 'quick-lru';
import { Address } from '../../entities/Address.js';
import { CacheError, RequestAbortedError } from '../../errors/index.js';
import { Geocoder } from '../Geocoder.js';
import { Decorator } from './Decorator.js';

const debug = Debug('geocoder:cache');

/**
 *  Cached service decorator
 */
export class Cache extends Decorator {
  private cache: CacheManager;
  // Map to deduplicate concurrent requests for the same query
  private pending = new Map<string, Promise<Address | null>>();

  /**
   * @param service - Geocoder service
   */
  constructor(
    service: Geocoder,
    options: { size?: number; ttl?: number; namespace?: string; secondary?: KeyvOptions }
  ) {
    super(service);
    debug(
      'initializing with size=%d, ttl=%d, namespace=%s',
      options.size || 1000,
      options.ttl || 0,
      options.namespace || 'default'
    );

    const stores: CreateCacheOptions['stores'] = [
      // In-memory cache with LRU
      new Keyv({
        namespace: options.namespace,
        store: new QuickLRU({ maxSize: options.size || 1000 }),
        compression: new KeyvBrotli({
          compressOptions: {
            params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MIN_QUALITY }
          }
        })
      })
    ];

    if (options.secondary) {
      if (!options.secondary.compression) {
        options.secondary.namespace = options.namespace;
        options.secondary.compression = new KeyvBrotli({
          compressOptions: {
            params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY }
          }
        });
      }
      stores.push(new Keyv(options.secondary));
    }

    this.cache = createCache({ ttl: options.ttl || 0, stores });
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    // Respect abort signal early
    if (options?.signal?.aborted) {
      debug('request aborted before cache lookup: %s', q);
      throw new RequestAbortedError(q);
    }

    // Check cache explicitly for undefined so that false (negative cache) is respected
    const cached = await this.cache.get<Address | false | undefined>(q);
    if (cached !== undefined) {
      debug('cache hit for: %s', q);
      // cached may be `false` sentinel which represents "not found"
      return (cached as Address) ?? null;
    }

    // If a request for the same query is in flight, return the existing promise
    const existing = this.pending.get(q);
    if (existing) {
      debug('deduplicating concurrent request for: %s', q);
      return existing;
    }

    // Start a new request and store the promise in the pending map
    const promise = this.geocoder
      .search(q, options)
      .then((address) => {
        // Don't cache if request was aborted in-flight
        if (!options?.signal?.aborted) {
          // Fire-and-forget cache write: do not block the response on cache set
          this.cache
            .set(q, address || false)
            .catch((err: Error) =>
              debug('cache write failed for %s: %s', q, err?.message ?? String(err))
            );
        } else {
          debug('not caching aborted request for: %s', q);
        }

        return address;
      })
      .finally(() => {
        // Ensure pending map is cleaned up regardless of outcome to avoid leaks
        this.pending.delete(q);
      });

    this.pending.set(q, promise);
    return promise;
  }
}
