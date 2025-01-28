import { Address } from '../../entities/Address';
import { Geocoder } from '../Geocoder';

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
    return this.geocoder
      .search(q, options)
      .then((address) => address ?? this.fallback.search(q, options));
  }
}
