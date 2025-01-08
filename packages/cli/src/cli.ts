#!/usr/bin/env node
import { Option, program } from 'commander';
import consola from 'consola';
import { AddressInfo } from 'net';
import pJson from '../package.json' with { type: 'json' };
import { createApp } from './app.js';
import { env } from './helpers/env.js';

/**
 * Create a new CLI program and add options to it.
 */
program
  .addOption(
    new Option('--osm-server [SERVER]', 'OpenStreetMap server to use')
      .default(env.OSM_SERVER)
      .env('OSM_SERVER')
  )
  .addOption(
    new Option('--osm-email [EMAIL]', 'Email to use for OpenStreetMap requests')
      .default(env.OSM_EMAIL)
      .env('OSM_EMAIL')
  )
  .addOption(
    new Option('--osm-agent [AGENT]', 'User agent to use for OpenStreetMap requests')
      .default(env.OSM_USER_AGENT)
      .env('OSM_USER_AGENT')
  )
  .addOption(
    new Option('--cache-dir [DIR]', 'Directory to store cache files')
      .default(env.CACHE_DIR)
      .env('CACHE_DIR')
  )
  .addOption(
    new Option('--cache-size [SIZE]', 'Number of records to keep in memory')
      .default(env.CACHE_SIZE)
      .env('CACHE_SIZE')
      .argParser(Number)
  )
  .addOption(new Option('-h, --host [HOST]', 'Host to listen on').default(env.HOST).env('HOST'))
  .addOption(
    new Option('-p, --port [PORT]', 'Port to listen on')
      .default(env.PORT)
      .env('PORT')
      .argParser(Number)
  )
  .helpOption('--help', 'Show usage instructions')
  .version(pJson.version)
  .action(async (options) => {
    const { osmServer, osmEmail, osmAgent } = options;
    if (osmServer === 'https://nominatim.openstreetmap.org' && (!osmEmail || !osmAgent)) {
      program.error(
        'You must provide an email and user agent for the default server (--help for more info)'
      );
    }

    const app = createApp({
      cache: { dirname: options.cacheDir, size: options.cacheSize },
      geocoder: {
        osmServer: osmServer,
        email: osmEmail,
        userAgent: osmAgent,
        concurrency: 1,
        minConfidence: 0
      },
      debug: env.NODE_ENV === 'development'
    });

    try {
      app.addHook('onListen', () => {
        const address = app.server.address() as AddressInfo;
        consola.info(`Server listening on http://${address.address}:${address.port}`);
      });

      await app.listen({ host: options.host, port: options.port });
    } catch (error) {
      consola.error(error);
      process.exit(1);
    }
  })
  .parse(process.argv);
