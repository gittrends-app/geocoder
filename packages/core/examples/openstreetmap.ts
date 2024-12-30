import consola from 'consola';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import prettyformat from 'pretty-format';
import { Cache, OpenStreetMap } from '../src/index.js';

(async function main() {
  // Create a new instance of the OpenStreetMap service
  const openstreetmap = new OpenStreetMap({ concurrency: 1, minConfidence: 0.5 });

  // Create a cache decorator for the OpenStreetMap service (optional)
  // This decorator works as a proxy for the OpenStreetMap service caching previous results
  const service = new Cache(openstreetmap, {
    dirname: resolve(tmpdir(), 'addresses.json'),
    size: 1000,
    ttl: 0
  });

  // Some examples of addresses for testing

  let response = await service.search('Europe');
  consola.info(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0.8778887201599463, "name": "Europe", "source": "Europe", "type": "continent"}

  response = await service.search('Earth planet');
  consola.info(prettyformat.format(response, { min: true }));
  // output: null

  response = await service.search('Brazil');
  consola.info(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0.8954966110329021, "country": "Brazil", "country_code": "BR", "name": "Brazil", "source": "Brazil", "type": "country"}

  response = await service.search('São Paulo, BR');
  consola.info(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0.7446516338789693, "country": "Brazil", "country_code": "BR", "name": "Brazil, São Paulo", "source": "São Paulo, BR", "state": "São Paulo", "type": "municipality"}
})();
