import { createHash } from 'node:crypto';
import { constants } from 'node:zlib';
import KeyvBrotli from '@keyv/compress-brotli';
import { Cache as CacheManager, CreateCacheOptions, createCache } from 'cache-manager';
import Debug from 'debug';
import Keyv, { KeyvOptions } from 'keyv';
import QuickLRU from 'quick-lru';
import { Address, AddressSchema } from '../../entities/Address.js';
import { RequestAbortedError } from '../../errors/index.js';
import { normalizeQueryKey, normalizeQueryWithOriginal } from '../../helpers/query.js';
import { Geocoder } from '../Geocoder.js';

const debug = Debug('geocoder:cache');

/**
 *  Cached service decorator
 */
export class Cache implements Geocoder {
  private readonly geocoder: Geocoder;
  private cache: CacheManager;
  private pending = new Map<string, PendingRequest>();
  private positiveTtl: number;
  private negativeTtl: number;

  /**
   * @param service - Geocoder service
   */
  constructor(service: Geocoder, options: CacheOptions = {}) {
    this.geocoder = service;
    const size = options.size ?? 1000;
    validateSize(size);
    const positiveTtl = options.positiveTtl ?? options.ttl ?? 0;
    const negativeTtl = options.negativeTtl ?? options.ttl ?? 0;
    validateTtl(positiveTtl);
    validateTtl(negativeTtl);
    if (options.namespace !== undefined && !options.namespace.trim()) {
      throw new TypeError('Cache namespace must be a non-empty string');
    }
    if (options.provider !== undefined && !options.provider.trim()) {
      throw new TypeError('Cache provider must be a non-empty string');
    }
    const configIdentity =
      options.config === undefined ? undefined : configNamespace(options.config);
    const namespace = [
      options.namespace ?? service.constructor.name,
      options.provider,
      configIdentity
    ]
      .filter(Boolean)
      .join(':');
    debug(
      'initializing with size=%d, ttl=%d, namespace=%s',
      size,
      positiveTtl,
      namespace || 'default'
    );

    const stores: CreateCacheOptions['stores'] = [
      // In-memory cache with LRU
      new Keyv({
        namespace,
        store: new QuickLRU({ maxSize: size })
      })
    ];

    if (options.secondary) {
      const secondary: KeyvOptions = {
        ...options.secondary,
        namespace: options.secondary.namespace ?? namespace
      };
      if (!secondary.compression) {
        secondary.compression = new KeyvBrotli({
          compressOptions: {
            params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY }
          }
        });
      }
      stores.push(new Keyv(secondary));
    }

    this.positiveTtl = positiveTtl;
    this.negativeTtl = negativeTtl;
    this.cache = createCache({ ttl: positiveTtl || undefined, stores });
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized, original } = normalizeQueryWithOriginal(q);
    const cacheKey = normalizeQueryKey(normalized);

    // Respect abort signal early
    if (options?.signal?.aborted) {
      debug('request aborted before cache lookup: %s', original);
      throw new RequestAbortedError(original);
    }

    // Check cache explicitly for undefined so that false (negative cache) is respected
    const cached = await this.getCached<Address | false | undefined>(
      cacheKey,
      normalized,
      options?.signal
    );
    if (options?.signal?.aborted) throw new RequestAbortedError(original);
    if (cached !== undefined) {
      debug('cache hit for: %s', normalized);
      // cached may be `false` sentinel which represents "not found"
      if (cached === false) return null;
      if (AddressSchema.safeParse(cached).success) {
        return cached.source === normalized ? cached : { ...cached, source: normalized };
      }
      await this.cache.del(cacheKey);
    }

    // If a request for the same folded query is in flight, join it. Each
    // caller still gets an independent abortable view of the shared request.
    const existing = this.pending.get(cacheKey);
    if (existing) {
      debug('deduplicating concurrent request for: %s', normalized);
      return this.join(existing, normalized, options?.signal);
    }

    const controller = new AbortController();
    const pending: PendingRequest = {
      controller,
      callers: 0,
      settled: false,
      query: normalized,
      promise: Promise.resolve()
        .then(() => this.geocoder.search(normalized, { signal: controller.signal }))
        .then((address) => {
          // Don't cache if request was aborted in-flight
          if (!controller.signal.aborted) {
            // Fire-and-forget cache write: do not block the response on cache set
            this.cache
              .set(
                cacheKey,
                address || false,
                address ? this.positiveTtl || undefined : this.negativeTtl || undefined
              )
              .catch((err: Error) =>
                debug('cache write failed for %s: %s', normalized, err?.message ?? String(err))
              );
          } else {
            debug('not caching aborted request for: %s', normalized);
          }

          return address;
        })
        .finally(() => {
          pending.settled = true;
          // Ensure pending map is cleaned up regardless of outcome to avoid leaks
          if (this.pending.get(cacheKey) === pending) this.pending.delete(cacheKey);
        })
    };

    // A request with no caller signal is still a regular shared request.
    this.pending.set(cacheKey, pending);
    pending.promise.catch(() => undefined);
    return this.join(pending, normalized, options?.signal);
  }

  private getCached<T>(key: string, query: string, signal?: AbortSignal): Promise<T | undefined> {
    const cachePromise = this.cache.get<T>(key);
    cachePromise.catch(() => undefined);
    if (!signal) return cachePromise;

    let onAbort!: () => void;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => reject(new RequestAbortedError(query));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    return Promise.race([cachePromise, abortPromise]).finally(() =>
      signal.removeEventListener('abort', onAbort)
    );
  }

  private join(
    pending: PendingRequest,
    query: string,
    signal?: AbortSignal
  ): Promise<Address | null> {
    if (signal?.aborted) return Promise.reject(new RequestAbortedError(query));

    pending.callers += 1;
    return new Promise<Address | null>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        pending.callers -= 1;
        if (!pending.settled && pending.callers === 0) {
          pending.controller.abort();
          // Do not make a newly-arriving caller join an already-cancelled
          // request after every previous caller has gone away.
          for (const [key, value] of this.pending) {
            if (value === pending) this.pending.delete(key);
          }
        }
      };
      const onAbort = () => {
        release();
        reject(new RequestAbortedError(query));
      };

      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      pending.promise.then(
        (address) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          release();
          if (signal?.aborted) reject(new RequestAbortedError(query));
          else
            resolve(address && (query === pending.query ? address : { ...address, source: query }));
        },
        (error: unknown) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          release();
          reject(error);
        }
      );
    });
  }
}

export type CacheOptions = {
  size?: number;
  ttl?: number;
  positiveTtl?: number;
  negativeTtl?: number;
  namespace?: string;
  provider?: string;
  config?: unknown;
  secondary?: KeyvOptions;
};

function validateTtl(ttl: number): void {
  if (!Number.isFinite(ttl) || ttl < 0)
    throw new RangeError('Cache TTL must be a finite non-negative number');
}

function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError('Cache size must be a positive integer');
  }
}

function configNamespace(config: unknown): string {
  let serialized: string;
  try {
    const value = JSON.stringify(config);
    if (value === undefined) throw new TypeError('value is not serializable');
    serialized = value;
  } catch (error) {
    throw new TypeError(
      `Cache config must be serializable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

type PendingRequest = {
  controller: AbortController;
  callers: number;
  settled: boolean;
  query: string;
  promise: Promise<Address | null>;
};