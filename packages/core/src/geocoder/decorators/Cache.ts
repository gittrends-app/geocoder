import KeyvBrotli from '@keyv/compress-brotli';
import { Cache as CacheManager, createCache } from 'cache-manager';
import { CacheableMemory } from 'cacheable';
import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { resolve } from 'node:path';
import { constants } from 'node:zlib';
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
  constructor(service: Geocoder, options: { dirname: string; size?: number; ttl?: number }) {
    super(service);

    this.cache = createCache({
      stores: [
        // In-memory cache with LRU
        new Keyv({
          store: new CacheableMemory({ ttl: options.ttl || 0, lruSize: options.size || 1000 }),
          compression: new KeyvBrotli({
            compressOptions: {
              params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MIN_QUALITY }
            }
          })
        }),
        // Sqlite Store
        new Keyv({
          store: new KeyvFile({
            filename: resolve(options.dirname, 'addresses.json'),
            writeDelay: 1000
          }),
          compression: new KeyvBrotli({
            compressOptions: {
              params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY }
            }
          })
        })
      ]
    });
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
