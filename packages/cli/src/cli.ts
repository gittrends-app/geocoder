#!/usr/bin/env node
import { InvalidArgumentError, Option, program } from 'commander';
import consola from 'consola';
import { AddressInfo } from 'net';
import pJson from '../package.json' with { type: 'json' };
import { createApp } from './app.js';
import {
  isDefaultNominatimServer,
  normalizeOsmServerUrl,
  parseCacheSize,
  parseConcurrency,
  parsePort,
  validateCacheDirectory,
  validateEmail,
  validateHost,
  validateUserAgent
} from './helpers/config.js';
import { env } from './helpers/env.js';

const commanderParser =
  <T>(parser: (value: string) => T) =>
  (value: string): T => {
    try {
      return parser(value);
    } catch (error) {
      throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
    }
  };

/**
 * Create a new CLI program and add options to it.
 */
program
  .addOption(
    new Option('--osm-server <SERVER>', 'OpenStreetMap server to use')
      .default(env.OSM_SERVER)
      .env('OSM_SERVER')
      .argParser(commanderParser(normalizeOsmServerUrl))
  )
  .addOption(
    new Option('--osm-email <EMAIL>', 'Email to use for OpenStreetMap requests')
      .default(env.OSM_EMAIL)
      .env('OSM_EMAIL')
      .argParser(commanderParser((value) => validateEmail(value) as string))
  )
  .addOption(
    new Option('--osm-agent <AGENT>', 'User agent to use for OpenStreetMap requests')
      .default(env.OSM_USER_AGENT)
      .env('OSM_USER_AGENT')
      .argParser(commanderParser((value) => validateUserAgent(value) as string))
  )
  .addOption(
    new Option('--cache-dir <DIR>', 'Directory to store cache files')
      .default(env.CACHE_DIR)
      .env('CACHE_DIR')
      .argParser(commanderParser((value) => validateCacheDirectory(value) as string))
  )
  .addOption(
    new Option('--cache-size <SIZE>', 'Number of records to keep in memory')
      .default(env.CACHE_SIZE)
      .env('CACHE_SIZE')
      .argParser(commanderParser(parseCacheSize))
  )
  .addOption(
    new Option('--concurrency <CONCURRENCY>', 'Number of concurrent geocoding requests')
      .default(env.CONCURRENCY)
      .env('CONCURRENCY')
      .argParser(commanderParser(parseConcurrency))
  )
  .addOption(
    new Option('-H, --host <HOST>', 'Host to listen on')
      .default(env.HOST)
      .env('HOST')
      .argParser(commanderParser(validateHost))
  )
  .addOption(
    new Option('-p, --port <PORT>', 'Port to listen on')
      .default(env.PORT)
      .env('PORT')
      .argParser(commanderParser(parsePort))
  )
  .helpOption('--help', 'Show usage instructions')
  .version(pJson.version)
  .action(async (options) => {
    const { osmServer, osmEmail, osmAgent } = options;
    const normalizedOsmServer = normalizeOsmServerUrl(osmServer);
    if (isDefaultNominatimServer(normalizedOsmServer) && (!osmEmail || !osmAgent)) {
      program.error(
        'You must provide an email and user agent for the default server (--help for more info)'
      );
    }

    const app = createApp({
      cache: { dirname: options.cacheDir, size: options.cacheSize },
      geocoder: {
        osmServer: normalizedOsmServer,
        email: osmEmail,
        userAgent: osmAgent,
        concurrency: options.concurrency,
        minConfidence: 0
      },
      debug: env.NODE_ENV === 'development',
      logLevel: env.LOG_LEVEL
    });

    try {
      app.addHook('onListen', () => {
        const address = app.server.address() as AddressInfo;
        consola.info(`Server listening on http://${address.address}:${address.port}`);
      });

      await app.listen({ host: options.host, port: options.port });

      // Graceful shutdown handler
      const shutdown = async (signal: string) => {
        consola.info(`Received ${signal}, starting graceful shutdown...`);
        try {
          // Fastify close drains its registered lifecycle; bound it so a
          // broken provider or hook cannot keep shutdown alive indefinitely.
          let timeoutHandle: NodeJS.Timeout | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error('Graceful shutdown timed out')),
              env.GRACEFUL_SHUTDOWN_TIMEOUT_MS
            );
          });
          try {
            await Promise.race([app.close(), timeout]);
          } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }
          consola.info('HTTP server closed');

          consola.success('Graceful shutdown complete');
          process.exit(0);
        } catch (error) {
          consola.error('Error during shutdown:', error);
          process.exit(1);
        }
      };

      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (error) {
      consola.error(error);
      process.exit(1);
    }
  })
  .parse(process.argv);
