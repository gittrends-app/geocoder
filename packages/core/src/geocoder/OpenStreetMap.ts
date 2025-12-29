import Debug from 'debug';
import type { MergeExclusive } from 'type-fest';
import { Address, AddressSchema } from '../entities/Address.js';
import fetch from '../helpers/fetch.js';
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
  class?: string;
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
  async search(q: string): Promise<Address | null> {
    debug('searching for: %s', q);
    const response = await fetch<NominatimSearchResult[]>(
      `https://nominatim.openstreetmap.org/search?${new URLSearchParams(
        [
          ['language', 'en-US'],
          ['osmServer', this.options.osmServer || ''],
          ['addressdetails', '1'],
          ['q', q],
          ['limit', '5'],
          ['format', 'json'],
          ['email', this.options.email || '']
        ].filter(([, v]) => v !== '')
      ).toString()}`
    ).json();

    if (response.length === 0) {
      debug('no results found for: %s', q);
      return null;
    }

    const location = response
      .filter((r) => r.importance && r.importance >= this.options.minConfidence)
      .filter((r) => r.class === 'place' || r.class === 'boundary')
      .reduce(
        (prev, current) => (!prev || current.importance! > prev.importance! ? current : prev),
        undefined as NominatimSearchResult | undefined
      );

    if (!location || !location.address) {
      debug(
        'address filtered: confidence %.3f < %.3f',
        location?.importance,
        this.options.minConfidence
      );
      return null;
    }

    const result = AddressSchema.parse({
      source: q,
      name: [location.address.country, location.address.state, location.address.city]
        .filter(Boolean)
        .join(', '),
      type: location.type,
      confidence: location.importance,
      country: location.address.country,
      country_code: location.address.country_code,
      state: location.address.state,
      city: location.address.city
    });
    debug('found address: %s (confidence: %.3f)', result.name, result.confidence);
    return result;
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
