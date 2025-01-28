import consola from 'consola';
import prettyformat from 'pretty-format';
import { Proton } from '../src/geocoder/Proton.js';

(async function main() {
  // Create a new instance of the Proton service
  const proton = new Proton({ concurrency: 2 });

  // Some examples of addresses for testing

  let response = await proton.search('Europe');
  consola.info(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0, "name": "Europe", "source": "Europe", "type": "continent"}

  response = await proton.search('Earth planet');
  consola.info(prettyformat.format(response, { min: true }));
  // output: null

  response = await proton.search('United Kingdom');
  consola.info(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0, "country": "United Kingdom", "country_code": "GB", "name": "United Kingdom", "source": "United Kingdom", "type": "country"}

  response = await proton.search('Brazil');
  consola.info(prettyformat.format(response, { min: true }));
  // output: {"confidence": 0, "country": "Brasil", "country_code": "BR", "name": "Brasil", "source": "Brazil", "type": "country"}

  response = await proton.search('São Paulo, BR');
  consola.info(prettyformat.format(response, { min: true }));
  // output: {"city": "São Paulo", "confidence": 0, "country": "Brasil", "country_code": "BR", "name": "São Paulo", "source": "São Paulo, BR", "state": "São Paulo", "type": "municipality"}
})();
