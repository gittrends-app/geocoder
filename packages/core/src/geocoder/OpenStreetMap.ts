import fetch from 'node-fetch';
import geocoder from 'node-geocoder';
import { Address, AddressSchema } from '../entities/Address.js';
import { Geocoder } from './Geocoder.js';
import { Throttler } from './decorators/Throttler.js';

/**
 * Base for OpenStreetMap geocoder service
 */
class BaseOpenStreetMap implements Geocoder {
  private geocoderService = geocoder({ provider: 'openstreetmap', language: 'en-US', fetch });

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string): Promise<Address | null> {
    // @ts-expect-error: geocode method does not match expected types
    const response = await this.geocoderService.geocode({ q, limit: 1 });

    if (response.length === 0) return null;

    return AddressSchema.parse({
      source: q,
      country: response[0].country,
      country_code: response[0].countryCode,
      state: response[0].state,
      city: response[0].city
    });
  }
}

/**
 * OpenStreetMap geocoder service
 */
export class OpenStreetMap extends Throttler implements Geocoder {
  /**
   * Constructor that consider API limits
   */
  constructor(options: { concurrency: number } = { concurrency: 1 }) {
    super(new BaseOpenStreetMap(), { ...options, intervalCap: 1000 });
  }
}
