import Debug from 'debug';
import { Address, AddressSchema } from '../entities/Address.js';
import { formatDisplayName } from '../helpers/displayName.js';
import fetch from '../helpers/fetch.js';
import { normalizeQueryWithOriginal } from '../helpers/query.js';
import { Throttler, type ThrottlerOptions } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

const debug = Debug('geocoder:Photon');

type PhotonSearchResult = {
  features?: Array<{
    properties: {
      osm_type?: string;
      osm_id?: number;
      osm_value?: string;
      name?: string;
      type?: string;
      country?: string;
      countrycode?: string;
      state?: string;
    };
    geometry?: { coordinates?: [number, number] };
  }>;
};

class BasePhoton implements Geocoder {
  constructor(
    private readonly language: string,
    private readonly timeoutMs?: number
  ) {}

  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized } = normalizeQueryWithOriginal(q);
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
        ['lang', this.language]
      ]).toString()}`,
      {
        signal: options?.signal,
        timeout: this.timeoutMs,
        retry: { limit: 0 },
        provider: 'photon'
      }
    ).then((res) => res.json());

    const [location] = Array.isArray(data?.features) ? data.features : [];
    if (!location || !location.properties || typeof location.properties !== 'object') return null;
    const parsed = AddressSchema.safeParse({
      provider: 'photon',
      source: normalized,
      name: formatDisplayName(
        [location.properties.name, location.properties.state, location.properties.country],
        location.properties.country ?? ''
      ),
      type: location.properties.osm_value ?? location.properties.type,
      confidence: 0,
      latitude: location.geometry?.coordinates?.[1],
      longitude: location.geometry?.coordinates?.[0],
      source_id:
        location.properties.osm_type && location.properties.osm_id !== undefined
          ? `${location.properties.osm_type}/${location.properties.osm_id}`
          : undefined,
      provenance: 'photon',
      country: location.properties.country,
      country_code: location.properties.countrycode,
      state: location.properties.state,
      city: location.properties.type === 'city' ? location.properties.name : undefined
    });
    if (!parsed.success) {
      debug('discarding malformed Photon result for: %s', normalized);
      return null;
    }
    return parsed.data;
  }
}

export type PhotonOptions = {
  concurrency?: number;
  language?: string;
  timeoutMs?: number;
  rate?: Omit<ThrottlerOptions, 'retries' | 'retryDelay'>;
  retries?: number;
};

export class Photon extends Throttler implements Geocoder {
  constructor(options: PhotonOptions = {}) {
    const queueOptions = options.rate
      ? {
          ...options.rate,
          concurrency: options.rate.concurrency ?? options.concurrency ?? 1
        }
      : { concurrency: options.concurrency ?? 1, intervalCap: 1, interval: 1000, strict: true };
    super(new BasePhoton(options.language ?? 'en', options.timeoutMs), {
      ...queueOptions,
      retries: options.retries ?? 2,
      retryDelay: 250
    });
  }
}
