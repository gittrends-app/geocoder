import fetchRetry from 'fetch-retry';
import fetch from 'node-fetch';

export default fetchRetry(fetch);
