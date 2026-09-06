import Debug from 'debug';
import { Address, AddressSchema, ConfidenceSchema } from '../entities/Address.js';
import { ValidationError } from '../errors/index.js';
import { adminFields, adminLevel } from '../helpers/admin.js';
import fetch from '../helpers/fetch.js';
import { finiteNumber, record } from '../helpers/provider.js';
import { normalizeQuery } from '../helpers/query.js';
import { queueOptions } from '../helpers/queue.js';
import { Throttler, type ThrottlerOptions } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

const debug = Debug('geocoder:openstreetmap');
const PUBLIC_SERVER = 'https://nominatim.openstreetmap.org';

type OpenStreetMapOptionsBase = {
  concurrency?: number;
  minConfidence?: number;
  language?: string;
  timeoutMs?: number;
  rate?: Omit<ThrottlerOptions, 'retries' | 'retryDelay'>;
  retries?: number;
};

/**
 * A custom Nominatim server can define its own identity policy. The public
 * server always requires both parts of the Nominatim usage identity.
 */
export type OpenStreetMapOptions = OpenStreetMapOptionsBase &
  (
    | { osmServer: string; email?: string; userAgent?: string }
    | { osmServer?: undefined; email: string; userAgent: string }
  );

type NominatimSearchResult = {
  place_id?: number;
  osm_type?: 'node' | 'way' | 'relation';
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  type?: string;
  addresstype?: string;
  category?: string;
  importance?: number;
  boundingbox?: [string, string, string, string];
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
};

function publicServer(server: string): boolean {
  try {
    return new URL(server).hostname.replace(/\.$/u, '') === 'nominatim.openstreetmap.org';
  } catch {
    return false;
  }
}

function normalizeServer(server: string | undefined): string {
  const value = server ?? PUBLIC_SERVER;
  if (!value.trim()) throw new TypeError('Nominatim server must be a non-empty URL');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError();
  } catch {
    throw new TypeError('Nominatim server must be a valid HTTP(S) URL');
  }
  return value.replace(/\/+$/u, '');
}

class BaseOpenStreetMap implements Geocoder {
  constructor(
    private readonly options: Required<Pick<OpenStreetMapOptions, 'osmServer' | 'language'>> &
      OpenStreetMapOptions
  ) {}

  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const normalized = normalizeQuery(q);
    const params = new URLSearchParams({
      q: normalized,
      addressdetails: '1',
      'accept-language': this.options.language,
      layer: 'address',
      limit: '5',
      format: 'jsonv2'
    });
    if (this.options.email) params.set('email', this.options.email);

    const response = await fetch<NominatimSearchResult[]>(
      `${this.options.osmServer}/search?${params.toString()}`,
      {
        headers: this.options.userAgent ? { 'User-Agent': this.options.userAgent } : undefined,
        signal: options?.signal,
        timeout: this.options.timeoutMs,
        provider: 'openstreetmap'
      }
    ).then((result) => result.json());

    if (!Array.isArray(response) || response.length === 0) return null;

    for (const rawLocation of response) {
      const location = record(rawLocation);
      if (!location) continue;
      const confidence = ConfidenceSchema.safeParse(location.importance ?? 0);
      if (!confidence.success || confidence.data < (this.options.minConfidence ?? 0)) continue;
      // Keep this provider scoped to administrative place resolution: reject
      // POIs/streets (e.g. shops, buildings) and results missing address data.
      const category = typeof location.category === 'string' ? location.category.toLowerCase() : '';
      if (!['place', 'boundary'].includes(category)) continue;
      const address = record(location.address);
      if (!address) continue;
      const level = adminLevel(location.addresstype, location.type);
      if (!level) continue;
      const featureName =
        location.name ??
        (level === 'country'
          ? address.country
          : level === 'state'
            ? address.state
            : level === 'city'
              ? (address.city ?? address.town ?? address.village)
              : address.county);
      const fields = adminFields(level, featureName, address);
      const bbox = Array.isArray(location.boundingbox)
        ? location.boundingbox.map(finiteNumber)
        : undefined;
      const parsed = AddressSchema.safeParse({
        provider: 'openstreetmap',
        source: normalized,
        ...fields,
        type: level,
        confidence: confidence.data,
        score: confidence.data,
        latitude: finiteNumber(location.lat),
        longitude: finiteNumber(location.lon),
        bbox: bbox?.length === 4 && bbox.every((value) => value !== undefined) ? bbox : undefined,
        source_id:
          typeof location.osm_type === 'string' &&
          (typeof location.osm_id === 'number' || typeof location.osm_id === 'string')
            ? `${location.osm_type}/${location.osm_id}`
            : typeof location.place_id === 'number' || typeof location.place_id === 'string'
              ? String(location.place_id)
              : undefined,
        provenance: 'openstreetmap'
      });
      if (parsed.success) return parsed.data;
    }
    debug('discarding malformed OpenStreetMap result for: %s', normalized);
    return null;
  }
}

export class OpenStreetMap extends Throttler implements Geocoder {
  constructor(options: OpenStreetMapOptions = {} as OpenStreetMapOptions) {
    const osmServer = normalizeServer(options.osmServer);
    const email = options.email?.trim();
    const userAgent = options.userAgent?.trim();
    if (publicServer(osmServer) && (!userAgent || !email)) {
      throw new ValidationError(
        'OpenStreetMap',
        osmServer,
        'public Nominatim requires a non-empty userAgent and email'
      );
    }
    const rateOptions = queueOptions(options.rate, options.concurrency);
    super(
      new BaseOpenStreetMap({
        ...options,
        osmServer,
        email,
        userAgent,
        language: options.language ?? 'en-US'
      }),
      {
        ...rateOptions,
        retries: options.retries ?? 2,
        retryDelay: 250
      }
    );
  }
}