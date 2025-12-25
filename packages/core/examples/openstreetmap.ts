import { tmpdir } from 'node:os';
import path from 'node:path';
import consola from 'consola';
import { KeyvFile } from 'keyv-file';
import prettyformat from 'pretty-format';
import { Cache, OpenStreetMap } from '../src/index.js';

(async function main() {
  // Create a new instance of the OpenStreetMap service
  const openstreetmap = new OpenStreetMap({
    concurrency: 1,
    minConfidence: 0.5,
    osmServer: 'https://nominatim.geocoding.ai'
  });

  // Create a cache decorator for the OpenStreetMap service (optional)
  // This decorator works as a proxy for the OpenStreetMap service caching previous results
  const service = new Cache(openstreetmap, {
    size: 1000,
    ttl: 0,
    namespace: 'openstreetmap-example',
    secondary: new KeyvFile({ filename: path.resolve(tmpdir(), 'geocoder-data.json') }) // any persistent cache implementation
  });

  // Some examples of addresses for testing

  let response = await service.search('Europe');
  consola.info(prettyformat(response, { min: true }));
  // output: {"confidence": 0.8778887201599463, "name": "Europe", "source": "Europe", "type": "continent"}

  response = await service.search('Earth planet');
  consola.info(prettyformat(response, { min: true }));
  // output: null

  response = await service.search('UK');
  consola.info(prettyformat(response, { min: true }));
  // output: {"confidence": 0.9299570012385155, "country": "United Kingdom", "country_code": "GB", "name": "United Kingdom", "source": "UK", "type": "country"}

  response = await service.search('Brazil');
  consola.info(prettyformat(response, { min: true }));
  // output: {"confidence": 0.8954966110329021, "country": "Brazil", "country_code": "BR", "name": "Brazil", "source": "Brazil", "type": "country"}

  response = await service.search('São Paulo, BR');
  consola.info(prettyformat(response, { min: true }));
  // output: {"confidence": 0.7446516338789693, "country": "Brazil", "country_code": "BR", "name": "Brazil, São Paulo", "source": "São Paulo, BR", "state": "São Paulo", "type": "municipality"}
})();
