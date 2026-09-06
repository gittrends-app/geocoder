import Debug from 'debug';
import { type Address, AddressSchema, ConfidenceSchema } from '../entities/Address.js';
import { formatDisplayName } from '../helpers/displayName.js';
import fetch from '../helpers/fetch.js';
import { normalizeQueryWithOriginal } from '../helpers/query.js';
import { Throttler, type ThrottlerOptions } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

const debug = Debug('geocoder:locationiq');

type LocationIQSearchResult = {
  place_id?: number;
  display_name?: string;
  class?: string;
  type?: string;
  importance?: number;
  rank_search?: number;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
  osm_type?: string;
  osm_id?: number;
  address?: Record<string, any>;
};

export type BaseLocationIQOptions = {
  apiKey: string;
  baseUrl?: string;
  minConfidence?: number;
  language?: string;
  timeoutMs?: number;
};

class BaseLocationIQ implements Geocoder {
  constructor(private readonly options: BaseLocationIQOptions) {}

  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized } = normalizeQueryWithOriginal(q);
    const base = this.options.baseUrl ?? 'https://us1.locationiq.com/v1';
    const params = new URLSearchParams({
      key: this.options.apiKey,
      q: normalized,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      'accept-language': this.options.language ?? 'en'
    });
    const raw = await fetch<LocationIQSearchResult[]>(`${base}/search.php?${params.toString()}`, {
      signal: options?.signal,
      timeout: this.options.timeoutMs,
      retry: { limit: 0 },
      provider: 'locationiq'
    });
    const response = typeof (raw as any)?.json === 'function' ? await (raw as any).json() : raw;
    if (!Array.isArray(response) || response.length === 0) return null;

    const candidate = response[0];
    if (!candidate || typeof candidate !== 'object') return null;
    const addr =
      candidate.address && typeof candidate.address === 'object' ? candidate.address : {};
    const confidenceResult = ConfidenceSchema.safeParse(
      candidate.importance ?? candidate.rank_search ?? 0
    );
    if (!confidenceResult.success) return null;
    const confidence = confidenceResult.data;
    if (this.options.minConfidence !== undefined && confidence < this.options.minConfidence)
      return null;

    const latitude = Number(candidate.lat);
    const longitude = Number(candidate.lon);
    const bbox = candidate.boundingbox?.map(Number);
    const score = candidate.importance ?? candidate.rank_search;
    const parsed = AddressSchema.safeParse({
      provider: 'locationiq',
      source: normalized,
      name: formatDisplayName(
        [addr.country, addr.state ?? addr.county, addr.city ?? addr.town ?? addr.village],
        candidate.display_name ?? ''
      ),
      type: candidate.type ?? candidate.class,
      confidence,
      score,
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
      bbox: bbox?.length === 4 && bbox.every(Number.isFinite) ? bbox : undefined,
      source_id:
        candidate.osm_type && candidate.osm_id !== undefined
          ? `${candidate.osm_type}/${candidate.osm_id}`
          : candidate.place_id !== undefined
            ? String(candidate.place_id)
            : undefined,
      provenance: 'locationiq',
      country: addr.country,
      country_code: addr.country_code?.toUpperCase?.(),
      state: addr.state ?? addr.county,
      city: addr.city ?? addr.town ?? addr.village
    });
    if (!parsed.success) {
      debug('discarding malformed LocationIQ result for: %s', normalized);
      return null;
    }
    return parsed.data;
  }
}

export type LocationIQOptions = {
  concurrency?: number;
  rate?: Omit<ThrottlerOptions, 'retries' | 'retryDelay'>;
  retries?: number;
} & BaseLocationIQOptions;

export class LocationIQ extends Throttler implements Geocoder {
  constructor(options: LocationIQOptions) {
    const { concurrency, rate, retries, ...opts } = options;
    const queueOptions = rate
      ? { ...rate, concurrency: rate.concurrency ?? concurrency ?? 1 }
      : { concurrency: concurrency ?? 1, intervalCap: 1, interval: 1000, strict: true };
    super(new BaseLocationIQ(opts), {
      ...queueOptions,
      retries: retries ?? 2,
      retryDelay: 250
    });
  }
}
