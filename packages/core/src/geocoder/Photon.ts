import Debug from 'debug';
import { Address, AddressSchema } from '../entities/Address.js';
import fetch from '../helpers/fetch.js';
import { normalizeQueryWithOriginal } from '../helpers/query.js';
import { Throttler } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

const debug = Debug('geocoder:Photon');

type PhotonSearchResult = {
  features?: Array<{
    properties: {
      osm_type: string;
      osm_id: number;
      osm_key: string;
      osm_value: string;
      name?: string;
      type?: string;
      country?: string;
      countrycode?: string;
      county?: string;
      state?: string;
    };
  }>;
};

/**
 * Base for Photon geocoder service
 */
class BasePhoton implements Geocoder {
  /**
   * Constructor that creates the geocoder service
   */
  constructor() {
    debug('initialized');
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized } = normalizeQueryWithOriginal(q);
    debug('searching for: %s', normalized);

    try {
      const data = await fetch<PhotonSearchResult>(
        `https://photon.komoot.io/api/?${new URLSearchParams([
          ['q', normalized],
          ['layer', 'district'],
          ['layer', 'city'],
          ['layer', 'county'],
          ['layer', 'state'],
          ['layer', 'country'],
          ['osm_tag', 'place'],
          ['osm_tag', 'boundary'],
          ['lang', 'en']
        ]).toString()}`,
        { signal: options?.signal }
      ).then((res) => res?.json());

      const [location] = Array.isArray(data?.features) ? data.features : [];
      if (!location || !location.properties || typeof location.properties !== 'object') {
        debug('no results found for: %s', normalized);
        return null;
      }

      const parsed = AddressSchema.safeParse({
        provider: 'photon',
        source: normalized,
        name:
          location.properties.name ||
          [location.properties.country, location.properties.state].filter(Boolean).join(', ') ||
          location.properties.country ||
          '',
        type: location.properties.osm_value,
        confidence: 0,
        country: location.properties.country,
        country_code: location.properties.countrycode,
        state: location.properties.state,
        city: location.properties.type === 'city' ? location.properties.name : undefined
      });
      if (!parsed.success) {
        debug('discarding malformed Photon result for: %s', normalized);
        return null;
      }
      debug('found address: %s', parsed.data.name);
      return parsed.data;
    } catch (error) {
      // Log and propagate unexpected errors
      debug(
        'photon error for %s: %s',
        normalized,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}

/**
 * Photon geocoder service
 */
export class Photon extends Throttler implements Geocoder {
  /**
   * Constructor that consider API limits
   * @param options - Service options
   */
  constructor({ concurrency }: { concurrency: number }) {
    super(new BasePhoton(), { concurrency, intervalCap: 1000 });
  }
}
