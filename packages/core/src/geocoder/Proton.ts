import { Address, AddressSchema } from '../entities/Address.js';
import fetch from '../helpers/fetch.js';
import { Throttler } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

/**
 * Base for Proton geocoder service
 */
class BaseProton implements Geocoder {
  /**
   * Constructor that creates the geocoder service
   */
  constructor() {}

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string): Promise<Address | null> {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${q}&layer=city&layer=state&layer=country&layer=other&osm_tag=place&lang=en`
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      features: Array<{
        properties: {
          osm_type: string;
          osm_id: number;
          osm_key: string;
          osm_value: string;
          name: string;
          type: string;
          country?: string;
          countrycode?: string;
          county?: string;
          state?: string;
        };
      }>;
    };

    const [location] = data.features || [];
    if (!location) return null;

    return AddressSchema.parse({
      source: q,
      name: location.properties.name,
      type: location.properties.osm_value,
      confidence: 0,
      country: location.properties.country,
      country_code: location.properties.countrycode,
      state: location.properties.state,
      city: location.properties.type === 'city' ? location.properties.name : undefined
    });
  }
}

/**
 * Proton geocoder service
 */
export class Proton extends Throttler implements Geocoder {
  /**
   * Constructor that consider API limits
   * @param options - Service options
   */
  constructor({ concurrency }: { concurrency: number }) {
    super(new BaseProton(), { concurrency, intervalCap: 1000 });
  }
}
