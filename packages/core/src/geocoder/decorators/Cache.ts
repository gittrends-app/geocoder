import KeyvBrotli from '@keyv/compress-brotli';
import { Cache as CacheManager, createCache } from 'cache-manager';
import Keyv from 'keyv';
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
    options: { dirname: string; size?: number; ttl?: number; secondary?: Keyv }
  ) {
    super(service);

    const stores: Keyv[] = [
      // In-memory cache with LRU
      new Keyv({
        store: new QuickLRU({ maxSize: options.size || 1000 }),
        compression: new KeyvBrotli({
          compressOptions: {
            params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MIN_QUALITY }
          }
        })
      })
    ];

    if (options.secondary) {
      // File cache
      new Keyv({
        store: options.secondary,
        compression: new KeyvBrotli({
          compressOptions: {
            params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY }
          }
        })
      });
    }

    this.cache = createCache({ ttl: options.ttl || 0, stores });
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const cached = await this.cache.get<Address>(q);
    if (cached) return cached;

    return this.geocoder.search(q, options).then(async (address) => {
      if (address) await this.cache.set(q, address);
      return address;
    });
  }
}
