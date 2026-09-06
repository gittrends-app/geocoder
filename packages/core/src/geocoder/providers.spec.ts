import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimitError, ValidationError } from '../errors/index.js';
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

  it('accepts explicit public Nominatim concurrency and rate options', () => {
    const identity = { userAgent: 'test', email: 'test@example.com' };
    expect(
      () =>
        new OpenStreetMap({
          ...identity,
          concurrency: 3,
          rate: { concurrency: 2, intervalCap: 2, interval: 1000 }
        })
    ).not.toThrow();
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
      name: 'Paris, France',
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

  it('accepts a boundary state from Nominatim addresstype and keeps missing importance at zero', async () => {
    const baseUrl = 'https://osm-state.example.com';
    nock(baseUrl)
      .get('/search')
      .query((query) => query.layer === 'address')
      .reply(200, [
        {
          category: 'boundary',
          type: 'administrative',
          addresstype: 'state',
          name: 'Texas',
          address: { country: 'United States', country_code: 'us' }
        }
      ]);
    const provider = new OpenStreetMap({ osmServer: baseUrl });

    await expect(provider.search('Texas')).resolves.toMatchObject({
      name: 'Texas, United States',
      type: 'state',
      state: 'Texas',
      confidence: 0
    });
  });

  it('classifies a Nominatim state district as county', async () => {
    const baseUrl = 'https://osm-county.example.com';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          category: 'boundary',
          type: 'administrative',
          addresstype: 'state_district',
          name: 'Travis District',
          address: { country: 'United States', state_district: 'Travis District' }
        }
      ]);
    const provider = new OpenStreetMap({ osmServer: baseUrl });

    const result = await provider.search('Travis District');
    expect(result).toMatchObject({
      name: 'United States',
      type: 'county'
    });
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('city');
  });

  it('Photon fails closed when feature properties are malformed', async () => {
    nock('https://photon.komoot.io')
      .get('/api/')
      .query(true)
      .reply(200, { features: [{ properties: null }] });
    const provider = new Photon({ concurrency: 1 });

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('Photon skips a non-administrative feature and backfills a state feature', async () => {
    const baseUrl = 'https://photon-state.example.com/api';
    nock(baseUrl)
      .get('/')
      .query(true)
      .reply(200, {
        features: [
          { properties: { type: 'district', name: 'Downtown', country: 'United States' } },
          { properties: { type: 'state', name: 'Texas', country: 'United States' } }
        ]
      });
    const provider = new Photon({ baseUrl });

    await expect(provider.search('Texas')).resolves.toMatchObject({
      name: 'Texas, United States',
      type: 'state',
      state: 'Texas'
    });
  });

  it('Photon skips malformed coordinates before accepting a later feature', async () => {
    const baseUrl = 'https://photon-coordinates.example.com/api';
    nock(baseUrl)
      .get('/')
      .query(true)
      .reply(200, {
        features: [
          {
            properties: { type: 'city', name: 'Bad City', country: 'France' },
            geometry: { coordinates: ['bad', 2] }
          },
          {
            properties: { type: 'city', name: 'Paris', country: 'France' },
            geometry: { coordinates: [2.35, 48.86] }
          }
        ]
      });
    const provider = new Photon({ baseUrl });

    await expect(provider.search('Paris')).resolves.toMatchObject({
      name: 'Paris, France',
      latitude: 48.86,
      longitude: 2.35
    });
  });

  it('LocationIQ fails closed for malformed confidence data', async () => {
    const baseUrl = 'https://locationiq.example.com/v1';
    nock(baseUrl)
      .get('/search')
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

  it('LocationIQ skips a non-administrative result and accepts a later city', async () => {
    const baseUrl = 'https://locationiq-admin.example.com/v1';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        { class: 'highway', type: 'residential', display_name: 'Street' },
        {
          class: 'place',
          type: 'city',
          name: 'Paris',
          importance: 0.4,
          address: { country: 'France', country_code: 'fr' }
        }
      ]);
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl });

    await expect(provider.search('Paris')).resolves.toMatchObject({
      name: 'Paris, France',
      type: 'city',
      city: 'Paris',
      score: 0.4
    });
  });

  it('LocationIQ accepts administrative boundaries without promoting counties', async () => {
    const baseUrl = 'https://locationiq-boundary.example.com/v1';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          class: 'boundary',
          type: 'administrative',
          name: 'Travis District',
          importance: 0.5,
          address: { country: 'United States', state_district: 'Travis District' }
        }
      ]);
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl });

    const result = await provider.search('Travis District');
    expect(result).toMatchObject({
      name: 'United States',
      type: 'county'
    });
    expect(result).not.toHaveProperty('state');
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
      .get('/search')
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

    await expect(provider.search('Somewhere')).rejects.toMatchObject({
      kind: 'transient'
    });
  });
});
