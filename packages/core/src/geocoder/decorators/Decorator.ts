import { Address } from '../../entities/Address';
import { Geocoder } from '../Geocoder';

/**
 * Geocoder service interface
 */
export abstract class Decorator implements Geocoder {
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
