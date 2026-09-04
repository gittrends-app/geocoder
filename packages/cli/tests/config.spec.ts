import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OSM_SERVER,
  isDefaultNominatimServer,
  normalizeOsmServerUrl,
  parseCacheSize,
  parseConcurrency,
  parseLogLevel,
  parsePort,
  parseRateLimitWindow,
  parseShutdownTimeout,
  validateCacheDirectory,
  validateEmail,
  validateUserAgent
} from '../src/helpers/config.js';
import { parseEnv } from '../src/helpers/env.js';

describe('CLI configuration validation', () => {
  it('normalizes safe HTTPS OSM base URLs', () => {
    expect(normalizeOsmServerUrl(`${DEFAULT_OSM_SERVER}/`)).toBe(DEFAULT_OSM_SERVER);
    expect(normalizeOsmServerUrl('https://maps.example.test/nominatim///')).toBe(
      'https://maps.example.test/nominatim'
    );
  });

  it.each([
    'http://maps.example.test',
    'https://user:password@maps.example.test',
    'https://maps.example.test?key=value',
    'https://maps.example.test/#fragment',
    'not a URL'
  ])('rejects unsafe OSM server %s', (server) => {
    expect(() => normalizeOsmServerUrl(server)).toThrow();
  });

  it.each([
    'https://nominatim.openstreetmap.org',
    'https://NOMINATIM.OPENSTREETMAP.ORG./search',
    'https://nominatim.openstreetmap.org./custom/path/'
  ])('recognizes all default Nominatim host forms: %s', (server) => {
    expect(isDefaultNominatimServer(server)).toBe(true);
  });

  it('does not confuse lookalike hosts with default Nominatim', () => {
    expect(isDefaultNominatimServer('https://nominatim.openstreetmap.org.example.test')).toBe(
      false
    );
  });

  it('validates bounded numeric settings and durations', () => {
    expect(parsePort(0)).toBe(0);
    expect(parseCacheSize('100')).toBe(100);
    expect(parseRateLimitWindow('250ms')).toBe(250);
    expect(parseRateLimitWindow('2 seconds')).toBe(2000);
    expect(parseShutdownTimeout('5000')).toBe(5000);
    expect(() => parsePort(Number.NaN)).toThrow();
    expect(() => parsePort(-1)).toThrow();
    expect(() => parseCacheSize(Infinity)).toThrow();
    expect(() => parseRateLimitWindow('0ms')).toThrow();
    expect(() => parseShutdownTimeout(121_000)).toThrow();
    expect(() => validateCacheDirectory('\u0000cache')).toThrow();
    expect(() => validateEmail('not-an-email')).toThrow();
    expect(() => validateUserAgent('')).toThrow();
  });

  it('validates positive concurrency values', () => {
    expect(parseConcurrency('4')).toBe(4);
    expect(() => parseConcurrency(0)).toThrow();
    expect(() => parseConcurrency(-1)).toThrow();
    expect(() => parseConcurrency(1.5)).toThrow();
  });

  it.each(['\t', '\n', '\r'])('rejects C0 control character %j in shared validators', (control) => {
    expect(() => normalizeOsmServerUrl(`https://maps.example.test/${control}path`)).toThrow();
    expect(() => validateUserAgent(`agent${control}value`)).toThrow();
    expect(() => validateCacheDirectory(`cache${control}dir`)).toThrow();
  });

  it.each(['localhost', 'example.test', '127.0.0.1', '::1', '[::1]', '2001:db8::1'])(
    'accepts valid host or IP literal %s',
    (host) => {
      expect(() => parseEnv({ HOST: host })).not.toThrow();
    }
  );

  it.each([
    'https://example.test',
    'example.test/path',
    'bad host',
    'bad..host',
    '-bad.example',
    'bad-.example',
    '999.999.999.999',
    '1.2.3.999'
  ])('rejects invalid host value %s', (host) => {
    expect(() => parseEnv({ HOST: host })).toThrow();
  });

  it('parses validated environment defaults and overrides', () => {
    const parsed = parseEnv({
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      OSM_SERVER: 'https://maps.example.test/',
      OSM_EMAIL: 'ops@example.test',
      OSM_USER_AGENT: 'test-agent',
      CACHE_SIZE: '25',
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000'
    });

    expect(parsed.PORT).toBe(0);
    expect(parsed.OSM_SERVER).toBe('https://maps.example.test');
    expect(parsed.GRACEFUL_SHUTDOWN_TIMEOUT_MS).toBe(5000);
    expect(() => parseEnv({ PORT: 'NaN' })).toThrow();
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrow();
    expect(() => parseEnv({ OSM_SERVER: 'http://localhost' })).toThrow();
  });

  it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])(
    'accepts valid log level %s',
    (level) => {
      expect(parseLogLevel(level)).toBe(level);
      expect(parseLogLevel(level.toUpperCase())).toBe(level);
    }
  );

  it('defaults LOG_LEVEL to info when absent', () => {
    const parsed = parseEnv({});
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('defaults CONCURRENCY to 1 when absent', () => {
    expect(parseEnv({}).CONCURRENCY).toBe(1);
  });

  it('parses CONCURRENCY from environment', () => {
    expect(parseEnv({ CONCURRENCY: '8' }).CONCURRENCY).toBe(8);
  });

  it.each(['0', '-1', '1.5', 'NaN', ''])('rejects invalid CONCURRENCY value %s', (value) => {
    expect(() => parseEnv({ CONCURRENCY: value })).toThrow();
  });

  it('parses LOG_LEVEL from environment', () => {
    const parsed = parseEnv({ LOG_LEVEL: 'debug' });
    expect(parsed.LOG_LEVEL).toBe('debug');
  });

  it('rejects invalid LOG_LEVEL values', () => {
    expect(() => parseLogLevel('invalid')).toThrow();
    expect(() => parseLogLevel('')).toThrow();
    expect(() => parseLogLevel('  ')).toThrow();
    expect(() => parseEnv({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});
