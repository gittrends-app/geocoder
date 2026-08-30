import { isIP } from 'node:net';
import { ValidationError } from '@/core';

export const DEFAULT_OSM_SERVER = 'https://nominatim.openstreetmap.org';
export const MAX_RATE_LIMIT_ENTRIES = 10_000;
export const MAX_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_CACHE_SIZE = 1_000_000;
export const MAX_SHUTDOWN_TIMEOUT_MS = 120_000;

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
