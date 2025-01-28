import PQueue from 'p-queue';
import { Address } from '../../entities/Address';
import { Geocoder } from '../Geocoder';
import { Decorator } from './Decorator';

/**
 * Throttler is a decorator that limits the rate of requests to the geocoder.
 */
export class Throttler extends Decorator {
  private queue;

  /**
   * Constructor
   * @param geocoder - Geocoder service
   */
  constructor(geocoder: Geocoder, options: ConstructorParameters<typeof PQueue>[0]) {
    super(geocoder);
    this.queue = new PQueue(options);
  }

  /**
   * Search for addresses
   * @param q - Search query
   * @returns Promise<Address | null> - The address found or null
   */
  async search(q: string, options?: { signal?: AbortSignal }): Promise<Address | null> {
    return this.queue.add(() => this.geocoder.search(q), options) as Promise<Address | null>;
  }
}
