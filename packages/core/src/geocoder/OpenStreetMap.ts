import fetch from 'node-fetch';
import geocoder from 'node-geocoder';
import { Address, AddressSchema } from '../entities/Address.js';
import { Geocoder } from './Geocoder.js';
import { Throttler } from './decorators/Throttler.js';

/**
 * Base for OpenStreetMap geocoder service
 */
class BaseOpenStreetMap implements Geocoder {
  private geocoderService;

  /**
   * Constructor that creates the geocoder service
   */
  constructor(private options: { minConfidence: number }) {
    this.geocoderService = geocoder({ provider: 'openstreetmap', language: 'en-US', fetch });
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string): Promise<Address | null> {
    // @ts-expect-error: geocode method does not match expected types
    const response = await this.geocoderService.geocode({ q, limit: 1 });

    if (response.length === 0) return null;

    const address = response[0];
    const [raw]: any = response['raw' as any];

    if (raw.importance < this.options.minConfidence) return null;

    return AddressSchema.parse({
      source: q,
      name:
        [address.country, address.state, address.city].filter(Boolean).join(', ') ||
        address.formattedAddress,
      type: raw.addresstype,
      confidence: raw.importance,
      country: address.country,
      country_code: address.countryCode,
      state: address.state,
      city: address.city
    });
  }
}

/**
 * OpenStreetMap geocoder service
 */
export class OpenStreetMap extends Throttler implements Geocoder {
  /**
   * Constructor that consider API limits
   * @param options - Service options
   * @param options.concurrency - Number of concurrent requests (default: 1)
   * @param options.minConfidence - Minimum confidence level (default: 0.5)
   */
  constructor(options: { concurrency: number; minConfidence?: number } = { concurrency: 1 }) {
    const { minConfidence, ...opts } = options;
    super(new BaseOpenStreetMap({ minConfidence: minConfidence || 0.5 }), {
      ...opts,
      intervalCap: 1000
    });
  }
}
