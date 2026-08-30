import Debug from 'debug';
import type { MergeExclusive } from 'type-fest';
import { Address, AddressSchema, ConfidenceSchema } from '../entities/Address.js';
import fetch from '../helpers/fetch.js';
import { normalizeQueryWithOriginal } from '../helpers/query.js';
import { Throttler } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

const debug = Debug('geocoder:openstreetmap');

type BaseOpenStreetMapOptions = { minConfidence: number } & MergeExclusive<
  { osmServer: string },
  { email: string; userAgent: string }
>;

type NominatimSearchResult = {
  place_id: number;
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  category?: string;
  importance?: number;
  boundingbox?: [string, string, string, string];
  address?: {
    house_number?: string;
    road?: string;
    suburb?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
};

/**
 * Base for OpenStreetMap geocoder service
 */
class BaseOpenStreetMap implements Geocoder {
  /**
   * Constructor that creates the geocoder service
   */
  constructor(private options: BaseOpenStreetMapOptions) {
    debug('initializing with options: %O', options);
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized } = normalizeQueryWithOriginal(q);
    debug('searching for: %s', normalized);
    const params = new URLSearchParams({
      q: normalized,
      addressdetails: '1',
      'accept-language': 'en-US',
      limit: '5',
      format: 'jsonv2'
    });
    if (this.options.email) params.set('email', this.options.email);

    const url = `${this.options.osmServer || 'https://nominatim.openstreetmap.org'}/search?${params.toString()}`;

    const response = await fetch<NominatimSearchResult[]>(url, {
      headers: this.options.userAgent ? { 'User-Agent': this.options.userAgent } : undefined,
      signal: options?.signal
    }).json();

    if (!Array.isArray(response) || response.length === 0) {
      debug('no results found for: %s', normalized);
      return null;
    }

    const location = response.reduce<NominatimSearchResult | undefined>((best, current) => {
      if (!current || typeof current !== 'object') return best;
      const confidence = ConfidenceSchema.safeParse(current.importance);
      if (!confidence.success || confidence.data < this.options.minConfidence) {
        return best;
      }

      // Check category exists before accessing
      if (!current.category || !['place', 'boundary'].includes(current.category)) {
        debug('filtered result: missing or invalid category');
        return best;
      }

      // Check address object exists
      if (!current.address || typeof current.address !== 'object') {
        debug('filtered result: missing address data');
        return best;
      }

      return !best || (current.importance ?? 0) > (best.importance ?? 0) ? current : best;
    }, undefined);

    if (!location) {
      debug('no valid results found for: %s', normalized);
      return null;
    }

    // Additional check after reduce
    if (!location.address) {
      debug('address filtered: missing address data');
      return null;
    }

    const parsed = AddressSchema.safeParse({
      provider: 'openstreetmap',
      source: normalized,
      name:
        [location.address.country, location.address.state, location.address.city]
          .filter(Boolean)
          .join(', ') || location.display_name,
      type: location.type ?? location.category,
      confidence: location.importance,
      country: location.address.country,
      country_code: location.address.country_code,
      state: location.address.state,
      city: location.address.city
    });
    if (!parsed.success) {
      debug('discarding malformed OpenStreetMap result for: %s', normalized);
      return null;
    }
    debug('found address: %s (confidence: %.3f)', parsed.data.name, parsed.data.confidence);
    return parsed.data;
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
