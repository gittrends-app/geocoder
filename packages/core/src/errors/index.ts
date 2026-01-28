/**
 * Error hierarchy for geocoder package
 */
export class GeocoderError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = new.target.name;
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, new.target);
    }
  }
}

export class RequestAbortedError extends GeocoderError {
  constructor(public readonly query?: string) {
    super(`Geocoding request aborted${query ? ` for query: ${query}` : ''}`);
  }
}

export class RateLimitError extends GeocoderError {
  constructor(
    public readonly provider: string,
    public readonly retryAfter?: number
  ) {
    super(`Rate limit exceeded for provider: ${provider}`);
  }
}

export class ValidationError extends GeocoderError {
  constructor(
    public readonly field: string,
    public readonly value: unknown,
    public readonly constraint: string
  ) {
    super(`Validation failed for ${field}: ${constraint}`);
  }
}

export class CacheError extends GeocoderError {
  constructor(operation: string, cause?: Error) {
    super(`Cache ${operation} failed`, cause);
  }
}

export class QueueFullError extends GeocoderError {
  constructor(public readonly queueSize: number) {
    super(`Queue is full: ${queueSize} items`);
  }
}

export class NoProvidersError extends GeocoderError {
  constructor() {
    super('No geocoder providers configured');
  }
}
