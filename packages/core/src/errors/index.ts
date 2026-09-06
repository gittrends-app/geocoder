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

export type ProviderErrorKind =
  | 'rate-limit'
  | 'authentication'
  | 'policy'
  | 'invalid-request'
  | 'transient';

export class ProviderError extends GeocoderError {
  constructor(
    message: string,
    public readonly provider = 'unknown',
    public readonly status?: number,
    public readonly kind?: ProviderErrorKind,
    public readonly retryAfter?: number,
    cause?: Error
  ) {
    super(message, cause);
  }

  get retryable(): boolean {
    return this.kind === 'rate-limit' || this.kind === 'transient';
  }
}

export class RequestAbortedError extends GeocoderError {
  constructor(public readonly query?: string) {
    super(`Geocoding request aborted${query ? ` for query: ${query}` : ''}`);
  }
}

export class RateLimitError extends ProviderError {
  constructor(provider: string, retryAfter?: number, status = 429, cause?: Error) {
    super(
      `Rate limit exceeded for provider: ${provider}`,
      provider,
      status,
      'rate-limit',
      retryAfter,
      cause
    );
  }

  get retryable(): true {
    return true;
  }
}

export class AuthenticationError extends ProviderError {
  constructor(provider: string, status = 401, cause?: Error) {
    super(
      `Authentication failed for provider: ${provider}`,
      provider,
      status,
      'authentication',
      undefined,
      cause
    );
  }
}

export class PolicyError extends ProviderError {
  constructor(provider: string, status = 403, cause?: Error) {
    super(
      `Provider policy rejected the request: ${provider}`,
      provider,
      status,
      'policy',
      undefined,
      cause
    );
  }
}

export class InvalidRequestError extends ProviderError {
  constructor(provider: string, status = 400, cause?: Error) {
    super(
      `Invalid request for provider: ${provider}`,
      provider,
      status,
      'invalid-request',
      undefined,
      cause
    );
  }
}

export class TransientError extends ProviderError {
  constructor(provider: string, status?: number, cause?: Error, retryAfter?: number) {
    super(
      `Transient failure for provider: ${provider}`,
      provider,
      status,
      'transient',
      retryAfter,
      cause
    );
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
