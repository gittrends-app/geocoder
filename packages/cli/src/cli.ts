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
    const app = createApp({
      cache: { dirname: options.cacheDir, size: options.cacheSize },
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
