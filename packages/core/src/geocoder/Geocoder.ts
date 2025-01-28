import { Address } from '../entities/Address';

/**
 * Geocoder service interface
 */
export interface Geocoder {
  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null>;
}
