import Debug from 'debug';
import fetch from 'ky';

const debug = Debug('geocoder:fetch');

export type FetchOptions = RequestInit & { timeout?: number };

/**
 *  Fetch with retry
 *
 * @param url
 * @param options
 * @returns
 */
export default function <T>(url: string | URL, options?: FetchOptions) {
  debug('fetching: %s', url);

  return fetch<T>(url, {
    retry: {
      limit: 3,
      delay: (attemptCount) => Math.pow(2, attemptCount) * 1000,
      shouldRetry: ({ error }) => (error ? true : undefined)
    },
    timeout: options?.timeout ?? 10000,
    throwHttpErrors: (status) => /^(418|429|5\d{2})$/.test(String(status)),
    ...options
  });
}
