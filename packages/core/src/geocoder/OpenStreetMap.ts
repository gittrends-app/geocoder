import geocoder from 'node-geocoder';
import { Address, AddressSchema } from '../entities/Address.js';
import fetch from '../helpers/fetch.js';
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
    this.geocoderService = geocoder({
      provider: 'openstreetmap',
      language: 'en-US',
      fetch: fetch as any
    });
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string): Promise<Address | null> {
    // @ts-expect-error: geocode method does not match expected types
    const response = await this.geocoderService.geocode({ q, limit: 3 });

    if (response.length === 0) return null;

    const raw = response['raw' as any] as { [k: string]: any; importance: number }[];
    const maxIndex = raw.findIndex(
      (r) => r.importance === Math.max(...raw.map((r) => r.importance))
    );

    const address = response[maxIndex];
    const rawAddress = raw[maxIndex];

    if (rawAddress.importance < this.options.minConfidence) return null;

    return AddressSchema.parse({
      source: q,
      name:
        [address.country, address.state, address.city].filter(Boolean).join(', ') ||
        address.formattedAddress,
      type: rawAddress.addresstype,
      confidence: rawAddress.importance,
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
