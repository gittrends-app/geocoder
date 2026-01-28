import consola from 'consola';
import prettyformat from 'pretty-format';
import { LocationIQ } from '../src/index.js';

(async function main() {
  // Ensure you set LOCATIONIQ_KEY in your environment
  const apiKey = process.env.LOCATIONIQ_KEY;
  if (!apiKey) {
    throw new Error('LOCATIONIQ_KEY environment variable is required for this example');
  }

  // Create a new instance of the LocationIQ service
  const locationiq = new LocationIQ({
    apiKey,
    concurrency: 1,
    minConfidence: 0.5
  });

  // Example searches
  let response = await locationiq.search('Seattle, WA');
  consola.info(prettyformat(response, { min: true }));

  response = await locationiq.search('Earth planet');
  consola.info(prettyformat(response, { min: true }));

  response = await locationiq.search('Brazil');
  consola.info(prettyformat(response, { min: true }));
})();
