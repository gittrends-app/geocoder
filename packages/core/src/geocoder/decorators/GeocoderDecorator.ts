import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';

/**
 * Geocoder service interface
 */
export abstract class GeocoderDecorator implements Geocoder {
  /**
   * Constructor
   * @param geocoder - Geocoder service
   */
  constructor(protected geocoder: Geocoder) {}

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  abstract search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null>;
}
