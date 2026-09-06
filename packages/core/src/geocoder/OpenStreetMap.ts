import Debug from 'debug';
import { Address, AddressSchema, ConfidenceSchema } from '../entities/Address.js';
import { ValidationError } from '../errors/index.js';
import { formatDisplayName } from '../helpers/displayName.js';
import fetch from '../helpers/fetch.js';
import { normalizeQueryWithOriginal } from '../helpers/query.js';
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
  type?: string;
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
    const { normalized } = normalizeQueryWithOriginal(q);
    const params = new URLSearchParams({
      q: normalized,
      addressdetails: '1',
      'accept-language': this.options.language,
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
        retry: { limit: 0 },
        provider: 'openstreetmap'
      }
    ).then((result) => result.json());

    if (!Array.isArray(response) || response.length === 0) return null;

    const location = response.reduce<NominatimSearchResult | undefined>((best, current) => {
      if (!current || typeof current !== 'object') return best;
      const confidence = ConfidenceSchema.safeParse(current.importance);
      if (!confidence.success || confidence.data < (this.options.minConfidence ?? 0)) return best;
      // Keep this provider scoped to administrative place resolution: reject
      // POIs/streets (e.g. shops, buildings) and results missing address data.
      if (!current.category || !['place', 'boundary'].includes(current.category)) return best;
      if (!current.address || typeof current.address !== 'object') return best;
      return !best || confidence.data > (best.importance ?? 0) ? current : best;
    }, undefined);
    if (!location) return null;

    const address = location.address ?? {};
    const confidence = ConfidenceSchema.safeParse(location.importance ?? 0);
    const lat = Number(location.lat);
    const lon = Number(location.lon);
    const bbox = location.boundingbox?.map(Number);
    const parsed = AddressSchema.safeParse({
      provider: 'openstreetmap',
      source: normalized,
      name: formatDisplayName(
        [address.country, address.state, address.city ?? address.town ?? address.village],
        location.display_name ?? ''
      ),
      type: location.type ?? location.category,
      confidence: confidence.success ? confidence.data : 0,
      score: confidence.success ? confidence.data : undefined,
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lon) ? lon : undefined,
      bbox: bbox?.length === 4 && bbox.every(Number.isFinite) ? bbox : undefined,
      source_id:
        location.osm_type && location.osm_id !== undefined
          ? `${location.osm_type}/${location.osm_id}`
          : location.place_id !== undefined
            ? String(location.place_id)
            : undefined,
      provenance: 'openstreetmap',
      country: address.country,
      country_code: address.country_code,
      state: address.state,
      city: address.city ?? address.town ?? address.village
    });
    if (!parsed.success) {
      debug('discarding malformed OpenStreetMap result for: %s', normalized);
      return null;
    }
    return parsed.data;
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
    const queueOptions = options.rate
      ? {
          ...options.rate,
          concurrency: options.rate.concurrency ?? options.concurrency ?? 1
        }
      : { concurrency: options.concurrency ?? 1, intervalCap: 1, interval: 1000, strict: true };
    super(
      new BaseOpenStreetMap({
        ...options,
        osmServer,
        email,
        userAgent,
        language: options.language ?? 'en-US'
      }),
      {
        ...queueOptions,
        retries: options.retries ?? 2,
        retryDelay: 250
      }
    );
  }
}
