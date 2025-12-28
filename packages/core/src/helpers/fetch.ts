import fetchRetry from 'fetch-retry';
import fetch, { RequestInfo, RequestInit } from 'node-fetch';

/**
 *  Fetch with retry
 *
 * @param url
 * @param options
 * @returns
 */
export default async function (url: string | URL | RequestInfo, options?: RequestInit) {
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
  return response;
}
