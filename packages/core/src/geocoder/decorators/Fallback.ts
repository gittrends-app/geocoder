import Debug from 'debug';
import { Address } from '../../entities/Address.js';
import { ProviderError, RequestAbortedError } from '../../errors/index.js';
import { normalizeQueryWithOriginal } from '../../helpers/query.js';
import { Geocoder } from '../Geocoder.js';

const debug = Debug('geocoder:fallback');

/**
 * Geocoder service interface
 */
export class Fallback implements Geocoder {
  /**
   * Constructor
   * @param geocoder - Geocoder service
   * @param fallback - Fallback geocoder service
   */
  constructor(
    protected geocoder: Geocoder,
    protected fallback: Geocoder
  ) {}

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    const { normalized } = normalizeQueryWithOriginal(q);
    debug('searching with primary geocoder for: %s', normalized);

    const abortIfNeeded = () => {
      if (options?.signal?.aborted) throw new RequestAbortedError(normalized);
    };

    let address: Address | null;
    try {
      address = await this.geocoder.search(normalized, options);
    } catch (error: unknown) {
      if (
        options?.signal?.aborted ||
        error instanceof RequestAbortedError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error instanceof RequestAbortedError ? error : new RequestAbortedError(normalized);
      }
      if (!(error instanceof ProviderError) || !error.retryable) throw error;
      debug('primary geocoder failed, using fallback for: %s', normalized);
      abortIfNeeded();
      return this.fallback.search(normalized, options);
    }

    abortIfNeeded();
    if (address) {
      debug('primary geocoder returned result for: %s', normalized);
      return address;
    }
    debug('primary geocoder returned null, using fallback for: %s', normalized);
    abortIfNeeded();
    return this.fallback.search(normalized, options);
  }
}
