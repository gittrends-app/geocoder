import Debug from 'debug';
import { Address, AddressSchema } from '../entities/Address.js';
import fetch from '../helpers/fetch.js';
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
  async search(q: string): Promise<Address | null> {
    debug('searching for: %s', q);

    try {
      const data = await fetch<PhotonSearchResult>(
        `https://photon.komoot.io/api/?${new URLSearchParams([
          ['q', q],
          ['layer', 'district'],
          ['layer', 'city'],
          ['layer', 'county'],
          ['layer', 'state'],
          ['layer', 'country'],
          ['osm_tag', 'place'],
          ['osm_tag', 'boundary'],
          ['lang', 'en']
        ]).toString()}`
      ).then((res) => res?.json());

      const [location] = data.features || [];
      if (!location) {
        debug('no results found for: %s', q);
        return null;
      }

      const result = AddressSchema.parse({
        provider: 'photon',
        source: q,
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
      debug('found address: %s', result.name);
      return result;
    } catch (error) {
      // Log and propagate unexpected errors
      debug('photon error for %s: %s', q, (error as Error).message);
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
