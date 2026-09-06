import Debug from 'debug';
import { type Address, AddressSchema, ConfidenceSchema } from '../entities/Address.js';
import { type AdminLevel, adminFields, adminLevel } from '../helpers/admin.js';
import fetch from '../helpers/fetch.js';
import { finiteNumber, type RecordValue, record } from '../helpers/provider.js';
import { normalizeQuery } from '../helpers/query.js';
import { queueOptions } from '../helpers/queue.js';
import { Throttler, type ThrottlerOptions } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

const debug = Debug('geocoder:locationiq');

type LocationIQSearchResult = {
  place_id?: number;
  display_name?: string;
  name?: string;
  class?: string;
  type?: string;
  importance?: number;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
  osm_type?: string;
  osm_id?: number;
  address?: Record<string, unknown>;
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

function locationIqLevel(candidate: RecordValue): AdminLevel | undefined {
  const className = text(candidate.class);
  if (className && className !== 'place' && className !== 'boundary') return undefined;

  const level = adminLevel(candidate.type);
  if (level) return level;
  if (className !== 'boundary' || text(candidate.type) !== 'administrative') return undefined;

  const address = record(candidate.address);
  if (!address) return undefined;
  if (['city', 'town', 'village', 'municipality', 'hamlet'].some((field) => text(address[field]))) {
    return 'city';
  }
  if (text(address.county) || text(address.state_district)) return 'county';
  if (text(address.state) || text(address.region) || text(address.province)) return 'state';
  return text(address.country) ? 'country' : undefined;
}

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
    const normalized = normalizeQuery(q);
    const base = (this.options.baseUrl ?? 'https://us1.locationiq.com/v1').replace(/\/+$/u, '');
    const params = new URLSearchParams({
      key: this.options.apiKey,
      q: normalized,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      normalizecity: '1',
      'accept-language': this.options.language ?? 'en'
    });
    const raw = await fetch<LocationIQSearchResult[]>(`${base}/search?${params.toString()}`, {
      signal: options?.signal,
      timeout: this.options.timeoutMs,
      provider: 'locationiq'
    });
    const response = typeof (raw as any)?.json === 'function' ? await (raw as any).json() : raw;
    if (!Array.isArray(response) || response.length === 0) return null;

    for (const rawCandidate of response) {
      const candidate = record(rawCandidate);
      if (!candidate) continue;
      const level = locationIqLevel(candidate);
      if (!level) continue;
      const confidenceResult = ConfidenceSchema.safeParse(candidate.importance ?? 0);
      if (
        !confidenceResult.success ||
        (this.options.minConfidence !== undefined &&
          confidenceResult.data < this.options.minConfidence)
      ) {
        continue;
      }

      const addr = record(candidate.address) ?? {};
      const fields = adminFields(level, candidate.name, addr);
      const bbox = Array.isArray(candidate.boundingbox)
        ? candidate.boundingbox.map(finiteNumber)
        : undefined;
      const parsed = AddressSchema.safeParse({
        provider: 'locationiq',
        source: normalized,
        ...fields,
        type: level,
        confidence: confidenceResult.data,
        score: candidate.importance,
        latitude: finiteNumber(candidate.lat),
        longitude: finiteNumber(candidate.lon),
        bbox: bbox?.length === 4 && bbox.every((value) => value !== undefined) ? bbox : undefined,
        source_id:
          typeof candidate.osm_type === 'string' &&
          (typeof candidate.osm_id === 'number' || typeof candidate.osm_id === 'string')
            ? `${candidate.osm_type}/${candidate.osm_id}`
            : candidate.place_id !== undefined
              ? String(candidate.place_id)
              : undefined,
        provenance: 'locationiq'
      });
      if (parsed.success) return parsed.data;
    }
    debug('discarding malformed LocationIQ result for: %s', normalized);
    return null;
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
    const rateOptions = queueOptions(rate, concurrency);
    super(new BaseLocationIQ(opts), {
      ...rateOptions,
      retries: retries ?? 2,
      retryDelay: 250
    });
  }
}