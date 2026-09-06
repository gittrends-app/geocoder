import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('uses validated defaults when environment variables are unset', () => {
    expect(parseEnv({})).toMatchObject({
      PORT: 3000,
      HOST: 'localhost',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      OSM_SERVER: 'https://nominatim.openstreetmap.org',
      CACHE_SIZE: 1000,
      CONCURRENCY: 1,
      PROVIDERS: ['osm', 'photon'],
      RATE_PROFILE: 'public',
      PROVIDER_LANGUAGE: 'en',
      PROVIDER_TIMEOUT_MS: 5000,
      PROVIDER_RETRIES: 2,
      RATE_LIMIT_ENABLED: false,
      RATE_LIMIT_MAX: 100,
      RATE_LIMIT_WINDOW: '1 minute',
      TRUST_PROXY: false
    });
    expect(parseEnv({}).OSM_EMAIL).toBeUndefined();
    expect(parseEnv({}).OSM_USER_AGENT).toBeUndefined();
  });

  it('coerces and validates supported environment overrides', () => {
    const parsed = parseEnv({
      PORT: '8080',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      LOG_LEVEL: 'DEBUG',
      OSM_SERVER: 'https://maps.example.test/nominatim/',
      OSM_EMAIL: 'ops@example.test',
      OSM_USER_AGENT: 'geocoder/1.0',
      CACHE_DIR: '/tmp/geocoder-cache',
      CACHE_SIZE: '25',
      CONCURRENCY: '4',
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
      PROVIDERS: 'photon,osm',
      RATE_PROFILE: 'self-hosted',
      PROVIDER_LANGUAGE: 'fr-FR',
      PROVIDER_TIMEOUT_MS: '2500',
      PROVIDER_RETRIES: '3',
      LOCATIONIQ_KEY: 'secret-key',
      CACHE_POSITIVE_TTL_MS: '2 seconds',
      CACHE_NEGATIVE_TTL_MS: '500ms',
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_MAX: '20',
      RATE_LIMIT_WINDOW: '30 seconds',
      TRUST_PROXY: 'true'
    });

    expect(parsed).toMatchObject({
      PORT: 8080,
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      OSM_SERVER: 'https://maps.example.test/nominatim',
      OSM_EMAIL: 'ops@example.test',
      OSM_USER_AGENT: 'geocoder/1.0',
      CACHE_DIR: '/tmp/geocoder-cache',
      CACHE_SIZE: 25,
      CONCURRENCY: 4,
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: 5000,
      PROVIDERS: ['photon', 'osm'],
      RATE_PROFILE: 'self-hosted',
      PROVIDER_LANGUAGE: 'fr-FR',
      PROVIDER_TIMEOUT_MS: 2500,
      PROVIDER_RETRIES: 3,
      LOCATIONIQ_KEY: 'secret-key',
      CACHE_POSITIVE_TTL_MS: 2000,
      CACHE_NEGATIVE_TTL_MS: 500,
      RATE_LIMIT_ENABLED: true,
      RATE_LIMIT_MAX: 20,
      RATE_LIMIT_WINDOW: '30 seconds',
      TRUST_PROXY: true
    });
  });

  it.each([
    ['PORT', 'not-a-number'],
    ['NODE_ENV', 'staging'],
    ['OSM_SERVER', 'http://maps.example.test'],
    ['CACHE_SIZE', '0.5'],
    ['CONCURRENCY', '0'],
    ['PROVIDERS', 'osm,osm'],
    ['RATE_PROFILE', 'fast'],
    ['PROVIDER_TIMEOUT_MS', '10'],
    ['RATE_LIMIT_ENABLED', 'yes'],
    ['RATE_LIMIT_WINDOW', 'forever'],
    ['TRUST_PROXY', 'sometimes']
  ])('rejects malformed %s values', (name, value) => {
    expect(() => parseEnv({ [name]: value })).toThrow();
  });
});