import Debug from 'debug';
import fetchRetry from 'fetch-retry';
import fetch, { RequestInfo, RequestInit } from 'node-fetch';

const debug = Debug('geocoder:fetch');

/**
 *  Fetch with retry
 *
 * @param url
 * @param options
 * @returns
 */
export default async function (url: string | URL | RequestInfo, options?: RequestInit) {
  debug('fetching: %s', url);
  const response = await fetchRetry(fetch)(url, {
    retries: 3,
    retryDelay: (attempt, error) => (error ? 1000 : Math.pow(2, attempt) * 500),
    retryOn: (_, error, response) => {
      return (
        error != null || (response && /^(418|429|5\d{2})$/.test(String(response.status))) || false
      );
    },
    ...options
  });
  if (response.status) Object.assign(response, { statusCode: response.status });
  debug('response status: %d for %s', response.status, url);
  return response;
}
