import KeyvBrotli from '@keyv/compress-brotli';
import { Cache as CacheManager, createCache, CreateCacheOptions } from 'cache-manager';
import Keyv, { KeyvOptions } from 'keyv';
import { constants } from 'node:zlib';
import QuickLRU from 'quick-lru';
import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';
import { GeocoderDecorator } from './GeocoderDecorator.js';

/**
 *  Cached service decorator
 */
export class Cache extends GeocoderDecorator {
  private cache: CacheManager;

  /**
   * @param service - Geocoder service
   */
  constructor(
    service: Geocoder,
    options: { size?: number; ttl?: number; namespace?: string; secondary?: KeyvOptions }
  ) {
    super(service);

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
    const cached = await this.cache.get<Address | false>(q);
    if (cached) return cached;

    return this.geocoder.search(q, options).then(async (address) => {
      await this.cache.set(q, address || false);
      return address;
    });
  }
}
