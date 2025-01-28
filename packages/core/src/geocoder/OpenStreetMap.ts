import { RequestInfo, RequestInit } from 'node-fetch';
import geocoder from 'node-geocoder';
import type { MergeExclusive } from 'type-fest';
import { Address, AddressSchema } from '../entities/Address';
import fetch from '../helpers/fetch';
import { Geocoder } from './Geocoder';
import { Throttler } from './decorators/Throttler';

type BaseOpenStreetMapOptions = { minConfidence: number } & MergeExclusive<
  { osmServer: string },
  { email: string; userAgent: string }
>;

/**
 * Base for OpenStreetMap geocoder service
 */
class BaseOpenStreetMap implements Geocoder {
  private geocoderService;

  /**
   * Constructor that creates the geocoder service
   */
  constructor(private options: BaseOpenStreetMapOptions) {
    this.geocoderService = geocoder({
      provider: 'openstreetmap',
      osmServer: options.osmServer,
      email: options.email,
      language: 'en-US',
      fetch: function (url: RequestInfo, fetchOptions?: RequestInit) {
        return fetch(url, {
          ...fetchOptions,
          headers: {
            ...fetchOptions?.headers,
            'User-Agent': options.userAgent || 'gittrends-geocoder'
          }
        });
      }
    });
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string): Promise<Address | null> {
    // @ts-expect-error: geocode method does not match expected types
    const response = await this.geocoderService.geocode({ q, limit: 5 });

    if (response.length === 0) return null;

    const raw = response['raw' as any] as {
      [k: string]: any;
      class?: string;
      type?: string;
      importance: number;
    }[];
    const maxIndex = raw.findIndex(
      (r) =>
        r.importance ===
          Math.max(
            ...raw
              .filter((r) => r.class === 'place' || r.class === 'boundary')
              .map((r) => r.importance)
          ) &&
        (r.class === 'place' || r.class === 'boundary')
    );

    const address = response[maxIndex];
    const rawAddress = raw[maxIndex];

    if (!address || rawAddress.importance < this.options.minConfidence) return null;

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

export type OpenStreetMapOptions = { concurrency: number } & BaseOpenStreetMapOptions;

/**
 * OpenStreetMap geocoder service
 */
export class OpenStreetMap extends Throttler implements Geocoder {
  /**
   * Constructor that consider API limits
   * @param options - Service options
   */
  constructor(options: OpenStreetMapOptions) {
    const { concurrency, ...opts } = options;
    super(new BaseOpenStreetMap(opts), {
      concurrency,
      intervalCap: 1000
    });
  }
}
