import fetchRetry from 'fetch-retry';
import fetch, { RequestInit } from 'node-fetch';

/**
 *  Fetch with retry
 *
 * @param url
 * @param options
 * @returns
 */
export default async function (url: string | URL, options?: RequestInit) {
  const response = await fetchRetry(fetch)(url, options);
  if (response.status) Object.assign(response, { statusCode: response.status });
  return response;
}
