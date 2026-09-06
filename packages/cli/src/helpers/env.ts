import z from 'zod';
import {
  DEFAULT_OSM_SERVER,
  normalizeOsmServerUrl,
  parseBoolean,
  parseCacheSize,
  parseConcurrency,
  parseDuration,
  parseLogLevel,
  parsePort,
  parseProviders,
  parseProviderTimeout,
  parseRateLimitMax,
  parseRateProfile,
  parseRetries,
  parseShutdownTimeout,
  validateApiKey,
  validateCacheDirectory,
  validateHost,
  validateLanguage,
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
  CONCURRENCY: z.preprocess((value) => parseConcurrency(value ?? 1), z.number()),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.preprocess(
    (value) => parseShutdownTimeout(value ?? 30_000),
    z.number()
  ),
  PROVIDERS: z.preprocess((value) => parseProviders(value ?? 'osm,photon'), z.array(z.string())),
  RATE_PROFILE: z.preprocess((value) => parseRateProfile(value ?? 'public'), z.string()),
  PROVIDER_LANGUAGE: z.preprocess((value) => validateLanguage(value ?? 'en'), z.string()),
  PROVIDER_TIMEOUT_MS: z.preprocess((value) => parseProviderTimeout(value ?? 5000), z.number()),
  PROVIDER_RETRIES: z.preprocess((value) => parseRetries(value ?? 2), z.number()),
  LOCATIONIQ_KEY: optionalString(
    z
      .string()
      .transform((value) => validateApiKey(value) as string)
      .optional()
  ),
  CACHE_POSITIVE_TTL_MS: z.preprocess(
    (value) => parseDuration(value ?? 3_600_000, 'CACHE_POSITIVE_TTL_MS'),
    z.number()
  ),
  CACHE_NEGATIVE_TTL_MS: z.preprocess(
    (value) => parseDuration(value ?? 300_000, 'CACHE_NEGATIVE_TTL_MS'),
    z.number()
  ),
  RATE_LIMIT_ENABLED: z.preprocess(
    (value) => parseBoolean(value ?? false, 'RATE_LIMIT_ENABLED'),
    z.boolean()
  ),
  RATE_LIMIT_MAX: z.preprocess((value) => parseRateLimitMax(value ?? 100), z.number()),
  RATE_LIMIT_WINDOW: z.preprocess((value) => {
    const window = value ?? '1 minute';
    parseDuration(window, 'rateLimit.timeWindow');
    return window;
  }, z.string()),
  TRUST_PROXY: z.preprocess((value) => parseBoolean(value ?? false, 'TRUST_PROXY'), z.boolean())
});

export function parseEnv(input: NodeJS.ProcessEnv = process.env) {
  return EnvSchema.parse(input);
}
