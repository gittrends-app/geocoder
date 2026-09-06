import { isIP } from 'node:net';
import { ValidationError } from '@/core';

export const DEFAULT_OSM_SERVER = 'https://nominatim.openstreetmap.org';
export const MAX_RATE_LIMIT_ENTRIES = 10_000;
export const MAX_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_CACHE_SIZE = 1_000_000;
export const MAX_SHUTDOWN_TIMEOUT_MS = 120_000;
export const MAX_PROVIDER_TIMEOUT_MS = 120_000;

export const PROVIDER_NAMES = ['osm', 'photon', 'locationiq'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
export const RATE_PROFILES = ['public', 'public-bulk', 'self-hosted'] as const;
export type RateProfile = (typeof RATE_PROFILES)[number];

const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/u;

function invalid(field: string, value: unknown, constraint: string): never {
  throw new ValidationError(field, value, constraint);
}

export function normalizeOsmServerUrl(value: unknown): string {
  if (typeof value !== 'string') invalid('OSM_SERVER', value, 'must be a URL');
  if (controlCharacters.test(value))
    invalid('OSM_SERVER', value, 'must not contain control characters');
  if (!value.trim()) invalid('OSM_SERVER', value, 'must be a URL');
  const input = value.trim();

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    invalid('OSM_SERVER', value, 'must be a valid HTTPS URL');
  }

  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    input.includes('?') ||
    input.includes('#')
  ) {
    invalid('OSM_SERVER', value, 'must be an HTTPS base URL without credentials, query, or hash');
  }

  const pathname = url.pathname.replace(/\/+$/u, '');
  return `${url.origin}${pathname}`;
}

export function isDefaultNominatimServer(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/u, '');
    return hostname === 'nominatim.openstreetmap.org';
  } catch {
    return false;
  }
}

export function parseBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    invalid(field, value, `must be an integer from ${minimum} to ${maximum}`);
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isFinite(number) ||
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    invalid(field, value, `must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

export function parsePort(value: unknown): number {
  return parseBoundedInteger(value, 'PORT', 0, 65_535);
}

export function parseCacheSize(value: unknown): number {
  return parseBoundedInteger(value, 'CACHE_SIZE', 0, MAX_CACHE_SIZE);
}

export function parseConcurrency(value: unknown): number {
  return parseBoundedInteger(value, 'CONCURRENCY', 1, Number.MAX_SAFE_INTEGER);
}

export function parseDuration(value: unknown, field: string): number {
  if (typeof value === 'number')
    return parseBoundedInteger(value, field, 1, MAX_RATE_LIMIT_WINDOW_MS);
  if (typeof value !== 'string' || !value.trim())
    invalid(field, value, 'must be a positive duration');
  const match = value
    .trim()
    .toLowerCase()
    .match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m|h|milliseconds?|seconds?|minutes?|hours?)?$/u);
  if (!match) invalid(field, value, 'must be a positive duration');
  const multiplier =
    {
      ms: 1,
      millisecond: 1,
      milliseconds: 1,
      s: 1_000,
      second: 1_000,
      seconds: 1_000,
      m: 60_000,
      minute: 60_000,
      minutes: 60_000,
      h: 3_600_000,
      hour: 3_600_000,
      hours: 3_600_000
    }[match[2] ?? 'ms'] ?? 0;
  const milliseconds = Number(match[1]) * multiplier;
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > MAX_RATE_LIMIT_WINDOW_MS
  ) {
    invalid(field, value, 'must be a positive duration of at most 24 hours');
  }
  return milliseconds;
}

export function parseProviders(value: unknown): ProviderName[] {
  if (Array.isArray(value)) value = value.join(',');
  if (typeof value !== 'string' || !value.trim())
    invalid('PROVIDERS', value, `must be a comma-separated list of: ${PROVIDER_NAMES.join(', ')}`);
  const providers = value.split(',').map((provider) => provider.trim().toLowerCase());
  if (
    providers.some((provider) => !PROVIDER_NAMES.includes(provider as ProviderName)) ||
    new Set(providers).size !== providers.length
  ) {
    invalid('PROVIDERS', value, `must contain unique providers: ${PROVIDER_NAMES.join(', ')}`);
  }
  return providers as ProviderName[];
}

export function parseRateProfile(value: unknown): RateProfile {
  if (
    typeof value !== 'string' ||
    !RATE_PROFILES.includes(value.trim().toLowerCase() as RateProfile)
  ) {
    invalid('RATE_PROFILE', value, `must be one of: ${RATE_PROFILES.join(', ')}`);
  }
  return value.trim().toLowerCase() as RateProfile;
}

export function validateLanguage(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/u.test(value.trim())) {
    invalid('PROVIDER_LANGUAGE', value, 'must be a language tag such as en or en-US');
  }
  return value.trim();
}

export function parseRetries(value: unknown): number {
  return parseBoundedInteger(value, 'PROVIDER_RETRIES', 0, 10);
}

export function parseProviderTimeout(value: unknown): number {
  return parseBoundedInteger(value, 'PROVIDER_TIMEOUT_MS', 100, MAX_PROVIDER_TIMEOUT_MS);
}

export function validateApiKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    controlCharacters.test(value) ||
    value.length > 512
  ) {
    invalid('LOCATIONIQ_KEY', value, 'must be a non-empty value of at most 512 characters');
  }
  return value.trim();
}

export function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && ['true', 'false'].includes(value.trim().toLowerCase()))
    return value.trim().toLowerCase() === 'true';
  invalid(field, value, 'must be true or false');
}

export function parseShutdownTimeout(value: unknown): number {
  return parseBoundedInteger(value, 'GRACEFUL_SHUTDOWN_TIMEOUT_MS', 100, MAX_SHUTDOWN_TIMEOUT_MS);
}

export function parseRateLimitMax(value: unknown): number {
  return parseBoundedInteger(value, 'rateLimit.max', 1, MAX_RATE_LIMIT_ENTRIES);
}

export function parseRateLimitWindow(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) {
    invalid('rateLimit.timeWindow', value, 'must be a positive duration');
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m|h|milliseconds?|seconds?|minutes?|hours?)$/u);
  if (!match) invalid('rateLimit.timeWindow', value, 'must be a positive duration');
  const amount = Number(match[1]);
  const units = match[2];
  const multiplier =
    {
      ms: 1,
      millisecond: 1,
      milliseconds: 1,
      s: 1_000,
      second: 1_000,
      seconds: 1_000,
      m: 60_000,
      minute: 60_000,
      minutes: 60_000,
      h: 3_600_000,
      hour: 3_600_000,
      hours: 3_600_000
    }[units] ?? invalid('rateLimit.timeWindow', value, 'must be a positive duration');
  const milliseconds = amount * multiplier;
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > MAX_RATE_LIMIT_WINDOW_MS
  ) {
    invalid('rateLimit.timeWindow', value, 'must be a positive duration of at most 24 hours');
  }
  return milliseconds;
}

export function validateCacheDirectory(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || controlCharacters.test(value)) {
    invalid('CACHE_DIR', value, 'must be a non-empty path without control characters');
  }
  return value.trim();
}

export function validateUserAgent(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    controlCharacters.test(value) ||
    value.length > 256
  ) {
    invalid('OSM_USER_AGENT', value, 'must be a non-empty value of at most 256 characters');
  }
  return value.trim();
}

export function validateEmail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    invalid('OSM_EMAIL', value, 'must be a valid email address');
  }
  return value;
}

export function validateHost(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || controlCharacters.test(value)) {
    invalid('HOST', value, 'must be a valid host name');
  }
  const host = value.trim();
  const ipLiteral = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(ipLiteral)) return ipLiteral;
  if (
    host.length > 253 ||
    /\s/u.test(host) ||
    /^\d+(?:\.\d+){3,}\.?$/u.test(host) ||
    !/^(?=.{1,253}\.?$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/u.test(
      host
    )
  ) {
    invalid('HOST', value, 'must be a valid host name or IP literal');
  }
  return host;
}

export const VALID_LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent'
] as const;
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];

export function parseLogLevel(value: unknown): LogLevel {
  if (typeof value !== 'string' || !value.trim()) {
    invalid('LOG_LEVEL', value, `must be one of: ${VALID_LOG_LEVELS.join(', ')}`);
  }
  const level = value.trim().toLowerCase();
  if (!VALID_LOG_LEVELS.includes(level as LogLevel)) {
    invalid('LOG_LEVEL', value, `must be one of: ${VALID_LOG_LEVELS.join(', ')}`);
  }
  return level as LogLevel;
}
