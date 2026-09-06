import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Photon } from './Photon.js';

describe('Photon', () => {
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

  it('fails closed when feature properties are malformed', async () => {
    nock('https://photon.komoot.io')
      .get('/api/')
      .query(true)
      .reply(200, { features: [{ properties: null }] });
    const provider = new Photon({ concurrency: 1 });

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('skips a non-administrative feature and backfills a state feature', async () => {
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

  it('skips malformed coordinates before accepting a later feature', async () => {
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

  it('skips invalid geometry and accepts a feature with source metadata', async () => {
    const baseUrl = 'https://photon-metadata.example.com/api';
    nock(baseUrl)
      .get('/')
      .query(true)
      .reply(200, {
        features: [
          { properties: { type: 'city', name: 'Bad', country: 'France' }, geometry: 'invalid' },
          {
            properties: {
              type: 'city',
              name: 'Paris',
              country: 'France',
              osm_type: 'relation',
              osm_id: 123
            },
            geometry: { coordinates: [2.35, 48.86] }
          }
        ]
      });
    const provider = new Photon({ baseUrl });

    await expect(provider.search('Paris')).resolves.toMatchObject({
      name: 'Paris, France',
      source_id: 'relation/123'
    });
  });

  it('fails closed when the response has no features', async () => {
    nock('https://photon.komoot.io').get('/api/').query(true).reply(200, {});
    const provider = new Photon();

    await expect(provider.search('Somewhere')).resolves.toBeNull();
  });

  it('propagates cancellation to an in-flight request', async () => {
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
});