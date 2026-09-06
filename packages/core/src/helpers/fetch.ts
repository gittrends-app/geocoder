import Debug from 'debug';
import fetch, { HTTPError, type Options, type RetryOptions, TimeoutError } from 'ky';
import { Agent } from 'undici';
import {
  AuthenticationError,
  GeocoderError,
  InvalidRequestError,
  PolicyError,
  RateLimitError,
  TransientError
} from '../errors/index.js';

const debug = Debug('geocoder:fetch');

// Connection pool dispatcher for long-running services
const dispatcher = new Agent({
  connections: 10,
  pipelining: 1,
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 600000
});

export type FetchOptions = Options & { dispatcher?: Agent; provider?: string };

function isCancellation(error: Error, signal?: AbortSignal): boolean {
  return signal?.aborted === true || error.name === 'AbortError';
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) ? seconds : (Date.parse(value) - Date.now()) / 1000;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(parsed, 60);
}

export function classifyFetchError(
  error: unknown,
  provider = 'unknown',
  signal?: AbortSignal
): Error {
  if (error instanceof GeocoderError) return error;
  if (!(error instanceof Error))
    return new TransientError(provider, undefined, new Error(String(error)));
  if (signal?.aborted || error.name === 'AbortError') {
    return error;
  }
  if (error instanceof TimeoutError || error.name === 'TimeoutError')
    return new TransientError(provider, undefined, error);
  if (error instanceof HTTPError) {
    const status = error.response.status;
    const retryAfter = retryAfterSeconds(error.response);
    if (status === 429) return new RateLimitError(provider, retryAfter, status, error);
    if (status === 401 || status === 407) return new AuthenticationError(provider, status, error);
    if (status === 403 || status === 418) return new PolicyError(provider, status, error);
    if (status >= 400 && status < 500) return new InvalidRequestError(provider, status, error);
    return new TransientError(provider, status, error, retryAfter);
  }
  return new TransientError(provider, undefined, error);
}

/**
 *  Fetch with retry
 *
 * @param url
 * @param options
 * @returns
 */
export default function <T>(url: string | URL, options?: FetchOptions) {
  debug('fetching: %s', url);

  const {
    headers: providedHeaders,
    retry: providedRetry,
    throwHttpErrors: providedThrowHttpErrors,
    timeout: providedTimeout,
    dispatcher: providedDispatcher,
    provider,
    ...requestOptions
  } = options ?? {};

  const headers = new Headers(providedHeaders);
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'gittrends-geocoder');

  const customShouldRetry =
    typeof providedRetry === 'object' && providedRetry ? providedRetry.shouldRetry : undefined;
  const retry: RetryOptions = {
    limit: 0,
    ...(typeof providedRetry === 'number' ? { limit: providedRetry } : providedRetry),
    shouldRetry: async (state) => {
      if (isCancellation(state.error, requestOptions.signal ?? undefined)) return false;

      if (customShouldRetry) {
        return customShouldRetry(state);
      }

      // Let Ky apply its normal policy when the caller explicitly enabled
      // retries (for example, with `{retry: {limit: 1}}`).
      return undefined;
    }
  };

  return fetch<T>(url, {
    ...requestOptions,
    retry,
    timeout: providedTimeout ?? 10000,
    throwHttpErrors: providedThrowHttpErrors ?? true,
    headers,
    // Ky passes this vendor-specific fetch option through to undici.
    // @ts-expect-error - dispatcher is supported by undici, but not by Ky's Options type
    dispatcher: providedDispatcher ?? dispatcher
  }).catch((error: unknown) => {
    throw classifyFetchError(error, provider, requestOptions.signal ?? undefined);
  });
}
