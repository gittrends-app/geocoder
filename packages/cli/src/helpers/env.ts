import z from 'zod';
import {
  DEFAULT_OSM_SERVER,
  normalizeOsmServerUrl,
  parseCacheSize,
  parseLogLevel,
  parsePort,
  parseShutdownTimeout,
  validateCacheDirectory,
  validateHost,
  validateUserAgent
} from './config.js';

const optionalString = (validator: z.ZodType<string | undefined>) =>
  z.preprocess((value) => (value === '' ? undefined : value), validator);

export const EnvSchema = z.object({
  PORT: z.preprocess((value) => parsePort(value ?? 3000), z.number()),
  HOST: z.preprocess((value) => validateHost(value ?? 'localhost'), z.string()),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.preprocess((value) => parseLogLevel(value ?? 'info'), z.string()),
  OSM_SERVER: z.preprocess(
    (value) => normalizeOsmServerUrl(value ?? DEFAULT_OSM_SERVER),
    z.string()
  ),
  OSM_EMAIL: optionalString(z.email().optional()),
  OSM_USER_AGENT: optionalString(z.string().transform(validateUserAgent).optional()),
  CACHE_DIR: optionalString(z.string().transform(validateCacheDirectory).optional()),
  CACHE_SIZE: z.preprocess((value) => parseCacheSize(value ?? 1000), z.number()),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.preprocess(
    (value) => parseShutdownTimeout(value ?? 30_000),
    z.number()
  )
});

export function parseEnv(input: NodeJS.ProcessEnv = process.env) {
  return EnvSchema.parse(input);
}

export const env = parseEnv();
