import Debug from 'debug';
import fetch from 'ky';
import { Agent } from 'undici';

const debug = Debug('geocoder:fetch');

// Connection pool dispatcher for long-running services
const dispatcher = new Agent({
  connections: 10,
  pipelining: 1,
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 600000
});

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
    throwHttpErrors: (status) => /^(403|418|429|5\d{2})$/.test(String(status)),
    headers: { 'User-Agent': 'gittrends-geocoder', ...options?.headers },
    // @ts-expect-error - undici dispatcher is valid but not in ky types
    dispatcher,
    ...options
  });
}
