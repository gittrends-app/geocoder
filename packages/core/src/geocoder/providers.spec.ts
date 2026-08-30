import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocationIQ } from './LocationIQ.js';
import { OpenStreetMap } from './OpenStreetMap.js';
import { Photon } from './Photon.js';

describe('provider response and cancellation boundaries', () => {
  beforeEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
    nock.disableNetConnect();
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
});
