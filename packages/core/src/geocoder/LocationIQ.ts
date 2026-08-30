import Debug from 'debug';
import { type Address, AddressSchema, ConfidenceSchema } from '../entities/Address.js';
import fetch from '../helpers/fetch.js';
import { normalizeQueryWithOriginal } from '../helpers/query.js';
import { Throttler } from './decorators/Throttler.js';
import { Geocoder } from './Geocoder.js';

const debug = Debug('geocoder:locationiq');

type LocationIQSearchResult = {
  display_name: string;
  class?: string;
  type?: string;
  importance?: number;
  rank_search?: number;
  address?: Record<string, any>;
};

export type BaseLocationIQOptions = {
  apiKey: string;
  baseUrl?: string;
  minConfidence?: number;
};

class BaseLocationIQ implements Geocoder {
  constructor(private options: BaseLocationIQOptions) {
    debug('initializing with options (hidden apiKey): %O', {
      baseUrl: options.baseUrl,
      minConfidence: options.minConfidence
    });
  }

  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized } = normalizeQueryWithOriginal(q);
    debug('searching for: %s', normalized);

    const base = this.options.baseUrl ?? 'https://us1.locationiq.com/v1';
    const params = new URLSearchParams({
      key: this.options.apiKey,
      q: normalized,
      format: 'json',
      addressdetails: '1',
      limit: '5'
    });

    const url = `${base}/search.php?${params.toString()}`;

    const raw = await fetch<LocationIQSearchResult[]>(url, { signal: options?.signal });
    // Support both Response-like objects (with .json()) and direct JSON returned by mocks
    const response =
      typeof (raw as any)?.json === 'function' ? await (raw as any).json() : (raw as any);

    if (!Array.isArray(response) || response.length === 0) {
      debug('no results from locationiq for: %s', normalized);
      return null;
    }

    const candidate = response[0];
    if (!candidate || typeof candidate !== 'object') return null;

    const addr =
      candidate.address && typeof candidate.address === 'object' ? candidate.address : {};
    const confidenceResult = ConfidenceSchema.safeParse(
      candidate.importance ?? candidate.rank_search ?? 0
    );
    if (!confidenceResult.success) return null;
    const confidence = confidenceResult.data;

    if (this.options.minConfidence && confidence < this.options.minConfidence) {
      debug('confidence below threshold: %s < %s', confidence, this.options.minConfidence);
      return null;
    }

    const parsed = AddressSchema.safeParse({
      provider: 'locationiq',
      source: normalized,
      name: [addr.country, addr.state ?? addr.county, addr.city ?? addr.town ?? addr.village]
        .filter(Boolean)
        .join(', '),
      type: candidate.type ?? candidate.class,
      confidence,
      country: addr.country,
      country_code: addr.country_code?.toUpperCase?.(),
      state: addr.state ?? addr.county,
      city: addr.city ?? addr.town ?? addr.village
    });

    if (!parsed.success) {
      debug('discarding malformed LocationIQ result for: %s', normalized);
      return null;
    }
    debug('found address: %s (confidence: %s)', parsed.data.name, parsed.data.confidence);
    return parsed.data;
  }
}

export type LocationIQOptions = { concurrency?: number } & BaseLocationIQOptions;

export class LocationIQ extends Throttler implements Geocoder {
  constructor(options: LocationIQOptions) {
    const { concurrency, ...opts } = options;
    super(new BaseLocationIQ(opts), { concurrency, intervalCap: 1000 });
  }
}
