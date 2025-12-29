import consola from 'consola';
import prettyformat from 'pretty-format';
import { Photon } from '../src/geocoder/Photon.js';

(async function main() {
  // Create a new instance of the Photon service
  const photon = new Photon({ concurrency: 2 });

  // Some examples of addresses for testing

  let response = await photon.search('Europe');
  consola.info(prettyformat(response, { min: true }));
  // output: {"confidence": 0, "name": "Europe", "source": "Europe", "type": "continent"}

  response = await photon.search('Earth planet');
  consola.info(prettyformat(response, { min: true }));
  // output: null

  response = await photon.search('United Kingdom');
  consola.info(prettyformat(response, { min: true }));
  // output: {"confidence": 0, "country": "United Kingdom", "country_code": "GB", "name": "United Kingdom", "source": "United Kingdom", "type": "country"}

  response = await photon.search('Brazil');
  consola.info(prettyformat(response, { min: true }));
  // output: {"confidence": 0, "country": "Brasil", "country_code": "BR", "name": "Brasil", "source": "Brazil", "type": "country"}

  response = await photon.search('São Paulo, BR');
  consola.info(prettyformat(response, { min: true }));
  // output: {"city": "São Paulo", "confidence": 0, "country": "Brasil", "country_code": "BR", "name": "São Paulo", "source": "São Paulo, BR", "state": "São Paulo", "type": "municipality"}
})();
