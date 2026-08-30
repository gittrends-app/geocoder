import Debug from 'debug';
import fetch, { type Options, type RetryOptions, TimeoutError } from 'ky';
import { Agent } from 'undici';

const debug = Debug('geocoder:fetch');

// Connection pool dispatcher for long-running services
const dispatcher = new Agent({
  connections: 10,
  pipelining: 1,
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 600000
});

export type FetchOptions = Options & { dispatcher?: Agent };

function isCancellation(error: Error, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    error.name === 'AbortError' ||
    error instanceof TimeoutError ||
    error.name === 'TimeoutError'
  );
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
    ...requestOptions
  } = options ?? {};

  const headers = new Headers(providedHeaders);
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'gittrends-geocoder');

  const customShouldRetry =
    typeof providedRetry === 'object' && providedRetry ? providedRetry.shouldRetry : undefined;
  const retry: RetryOptions = {
    limit: 3,
    delay: (attemptCount) => Math.pow(2, attemptCount) * 1000,
    // Retain the helper's historical 403/418 behavior while leaving the
    // actual status and Retry-After decisions to Ky.
    statusCodes: [403, 418, 429, 500, 502, 503, 504],
    ...(typeof providedRetry === 'number' ? { limit: providedRetry } : providedRetry),
    shouldRetry: async (state) => {
      if (isCancellation(state.error, requestOptions.signal ?? undefined)) return false;

      // A caller-provided policy remains supported, but cannot make an
      // aborted or timed-out request retry.
      if (customShouldRetry) {
        return customShouldRetry(state);
      }

      // Undefined delegates status, method, network-error, and Retry-After
      // handling to Ky's normal retry machinery.
      return undefined;
    }
  };

  return fetch<T>(url, {
    ...requestOptions,
    retry,
    timeout: providedTimeout ?? 10000,
    throwHttpErrors:
      providedThrowHttpErrors ?? ((status) => /^(403|418|429|5\d{2})$/.test(String(status))),
    headers,
    // Ky passes this vendor-specific fetch option through to undici.
    // @ts-expect-error - dispatcher is supported by undici, but not by Ky's Options type
    dispatcher: providedDispatcher ?? dispatcher
  });
}
