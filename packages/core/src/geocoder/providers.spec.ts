import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimitError, TransientError, ValidationError } from '../errors/index.js';
import { Fallback } from './decorators/Fallback.js';
import { LocationIQ } from './LocationIQ.js';
import { OpenStreetMap } from './OpenStreetMap.js';
import { Photon } from './Photon.js';

describe('provider response and cancellation boundaries', () => {
  beforeEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
    nock.disableNetConnect();
  });

  it('propagates rate-limit errors from HTTP layer', async () => {
    const baseUrl = 'https://osm-errors.example.com';
    nock(baseUrl).get('/search').query(true).reply(429, 'Too Many Requests');
    const provider = new OpenStreetMap({
      concurrency: 1,
      minConfidence: 0,
      osmServer: baseUrl,
      userAgent: 'test',
      email: 'test@example.com',
      retries: 0
    });

    await expect(provider.search('Somewhere')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('requires identity details for the public Nominatim server', () => {
    expect(() => new OpenStreetMap({ osmServer: 'https://nominatim.openstreetmap.org' })).toThrow(
      ValidationError
    );
  });

  it('keeps provider metadata and configured language', async () => {
    const baseUrl = 'https://osm-metadata.example.com';
    nock(baseUrl)
      .get('/search')
      .query((query) => query.q === 'Paris' && query['accept-language'] === 'fr-FR')
      .reply(200, [
        {
          place_id: 123,
          osm_type: 'relation',
          osm_id: 456,
          lat: '48.8566',
          lon: '2.3522',
          boundingbox: ['48.8', '48.9', '2.2', '2.4'],
          type: 'city',
          category: 'place',
          importance: 0.9,
          display_name: 'Paris, France',
          address: { country: 'France', country_code: 'fr', city: 'Paris' }
        }
      ]);
    const provider = new OpenStreetMap({
      osmServer: baseUrl,
      language: 'fr-FR',
      minConfidence: 0,
      userAgent: 'test',
      email: 'test@example.com'
    });

    await expect(provider.search('Paris')).resolves.toMatchObject({
      name: 'France, Paris',
      latitude: 48.8566,
      longitude: 2.3522,
      bbox: [48.8, 48.9, 2.2, 2.4],
      source_id: 'relation/456',
      provenance: 'openstreetmap'
    });
  });

  afterEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('OSM fails closed for a malformed payload', async () => {
    const baseUrl = 'https://osm.example.com';
    nock(baseUrl).get('/search').query(true).reply(200, { malformed: true });
    const provider = new OpenStreetMap({
      concurrency: 1,
      minConfidence: 0,
      osmServer: baseUrl
    });

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('rejects non-administrative categories to keep place-level resolution', async () => {
    const baseUrl = 'https://osm-category.example.com';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          place_id: 1,
          category: 'shop',
          type: 'bakery',
          importance: 0.9,
          display_name: 'Bakery, Paris, France',
          address: { country: 'France', city: 'Paris' }
        }
      ]);
    const provider = new OpenStreetMap({ concurrency: 1, minConfidence: 0, osmServer: baseUrl });

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('rejects results without address data even when category matches', async () => {
    const baseUrl = 'https://osm-no-address.example.com';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          place_id: 1,
          category: 'place',
          type: 'city',
          importance: 0.9,
          display_name: 'Paris, France'
        }
      ]);
    const provider = new OpenStreetMap({ concurrency: 1, minConfidence: 0, osmServer: baseUrl });

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('Photon fails closed when feature properties are malformed', async () => {
    nock('https://photon.komoot.io')
      .get('/api/')
      .query(true)
      .reply(200, { features: [{ properties: null }] });
    const provider = new Photon({ concurrency: 1 });

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('LocationIQ fails closed for malformed confidence data', async () => {
    const baseUrl = 'https://locationiq.example.com/v1';
    nock(baseUrl)
      .get('/search.php')
      .query(true)
      .reply(200, [
        {
          importance: [],
          type: 'city',
          address: { country: 'United States', country_code: 'us' }
        }
      ]);
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl, concurrency: 1 });

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('propagates cancellation to an in-flight OSM request', async () => {
    const baseUrl = 'https://osm-abort.example.com';
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const scope = nock(baseUrl)
      .get('/search')
      .query(true)
      .delayBody(200)
      .reply(() => {
        requestStarted();
        return [200, []];
      });
    const provider = new OpenStreetMap({
      concurrency: 1,
      minConfidence: 0,
      osmServer: baseUrl
    });
    const controller = new AbortController();
    const request = provider.search('Somewhere', { signal: controller.signal });

    await started;
    controller.abort();
    await expect(request).rejects.toThrow();
    expect(scope.isDone()).toBe(true);
  });

  it('propagates cancellation to an in-flight Photon request', async () => {
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const scope = nock('https://photon.komoot.io')
      .get('/api/')
      .query(true)
      .delayBody(200)
      .reply(() => {
        requestStarted();
        return [200, { features: [] }];
      });
    const provider = new Photon({ concurrency: 1 });
    const controller = new AbortController();
    const request = provider.search('Somewhere', { signal: controller.signal });

    await started;
    controller.abort();
    await expect(request).rejects.toThrow();
    expect(scope.isDone()).toBe(true);
  });

  it('propagates cancellation to an in-flight LocationIQ request', async () => {
    const baseUrl = 'https://locationiq-abort.example.com/v1';
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const scope = nock(baseUrl)
      .get('/search.php')
      .query(true)
      .delayBody(200)
      .reply(() => {
        requestStarted();
        return [200, []];
      });
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl, concurrency: 1 });
    const controller = new AbortController();
    const request = provider.search('Somewhere', { signal: controller.signal });

    await started;
    controller.abort();
    await expect(request).rejects.toThrow();
    expect(scope.isDone()).toBe(true);
  });

  it('keeps provider timeouts retryable so fallback can handle them', async () => {
    const osm = 'https://osm-timeout.example.com';
    nock(osm).get('/search').query(true).delay(100).reply(200, []);
    nock('https://photon.komoot.io').get('/api/').query(true).reply(200, { features: [] });

    const primary = new OpenStreetMap({ osmServer: osm, timeoutMs: 10, retries: 0 });
    const fallback = new Photon({ timeoutMs: 1000, retries: 0 });

    await expect(new Fallback(primary, fallback).search('Somewhere')).resolves.toBeNull();
  });

  it('passes provider timeout to the fetch after queue dequeue', async () => {
    const osm = 'https://osm-timeout-result.example.com';
    nock(osm).get('/search').query(true).delay(100).reply(200, []);
    const provider = new OpenStreetMap({ osmServer: osm, timeoutMs: 10, retries: 0 });

    await expect(provider.search('Somewhere')).rejects.toBeInstanceOf(TransientError);
  });
});
