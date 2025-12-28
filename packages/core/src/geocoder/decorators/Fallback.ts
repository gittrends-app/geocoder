import Debug from 'debug';
import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';

const debug = Debug('geocoder:fallback');

/**
 * Geocoder service interface
 */
export class Fallback implements Geocoder {
  /**
   * Constructor
   * @param geocoder - Geocoder service
   * @param fallback - Fallback geocoder service
   */
  constructor(
    protected geocoder: Geocoder,
    protected fallback: Geocoder
  ) {}

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    debug('searching with primary geocoder for: %s', q);
    return this.geocoder
      .search(q, options)
      .then((address) => {
        if (address) {
          debug('primary geocoder returned result for: %s', q);
          return address;
        }
        debug('primary geocoder returned null, using fallback for: %s', q);
        return this.fallback.search(q, options);
      })
      .catch((error) => {
        debug('primary geocoder failed, using fallback for: %s - error: %s', q, error.message);
        return this.fallback.search(q, options);
      });
  }
}
