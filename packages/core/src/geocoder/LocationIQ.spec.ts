import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocationIQ } from './LocationIQ.js';

describe('LocationIQ', () => {
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

  it('fails closed for malformed confidence data', async () => {
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

  it('skips a non-administrative result and accepts a later city', async () => {
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

  it('accepts administrative boundaries without promoting counties', async () => {
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

  it.each(['town', 'village', 'municipality', 'hamlet'])(
    'detects a city from a boundary %s address field',
    async (field) => {
      const baseUrl = `https://locationiq-${field}.example.com/v1`;
      nock(baseUrl)
        .get('/search')
        .query(true)
        .reply(200, [
          {
            class: 'boundary',
            type: 'administrative',
            name: 'Small Place',
            address: { [field]: 'Small Place', country: 'France' }
          }
        ]);
      const provider = new LocationIQ({ apiKey: 'test-key', baseUrl });

      await expect(provider.search('Small Place')).resolves.toMatchObject({
        type: 'city',
        city: 'Small Place'
      });
    }
  );

  it.each(['state', 'region', 'province'])(
    'falls back to a boundary %s field for state',
    async (field) => {
      const baseUrl = `https://locationiq-${field}.example.com/v1`;
      nock(baseUrl)
        .get('/search')
        .query(true)
        .reply(200, [
          {
            class: 'boundary',
            type: 'administrative',
            name: 'Normandy',
            address: { [field]: 'Normandy', country: 'France' }
          }
        ]);
      const provider = new LocationIQ({ apiKey: 'test-key', baseUrl });

      await expect(provider.search('Normandy')).resolves.toMatchObject({
        type: 'state',
        state: 'Normandy'
      });
    }
  );

  it('falls back to country for a boundary with no other administrative fields', async () => {
    const baseUrl = 'https://locationiq-country.example.com/v1';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          class: 'boundary',
          type: 'administrative',
          name: 'France',
          address: { country: 'France', country_code: 'fr' }
        }
      ]);
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl });

    await expect(provider.search('France')).resolves.toMatchObject({
      type: 'country',
      country: 'France'
    });
  });

  it('omits a bounding box containing non-finite coordinates', async () => {
    const baseUrl = 'https://locationiq-bbox.example.com/v1';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          class: 'place',
          type: 'city',
          name: 'Paris',
          address: { country: 'France' },
          boundingbox: ['48.8', 'not finite', '2.2', '2.4']
        }
      ]);
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl });

    await expect(provider.search('Paris')).resolves.toMatchObject({
      type: 'city',
      bbox: undefined
    });
  });

  it('skips a result below the configured confidence threshold', async () => {
    const baseUrl = 'https://locationiq-confidence.example.com/v1';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          class: 'place',
          type: 'city',
          name: 'Paris',
          importance: 0.2,
          address: { country: 'France' }
        }
      ]);
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl, minConfidence: 0.5 });

    await expect(provider.search('Paris')).resolves.toBeNull();
  });

  it('uses place_id when OSM source metadata is unavailable', async () => {
    const baseUrl = 'https://locationiq-place-id.example.com/v1';
    nock(baseUrl)
      .get('/search')
      .query(true)
      .reply(200, [
        {
          class: 'place',
          type: 'city',
          name: 'Paris',
          place_id: 321,
          address: { country: 'France' }
        }
      ]);
    const provider = new LocationIQ({ apiKey: 'test-key', baseUrl });

    await expect(provider.search('Paris')).resolves.toMatchObject({ source_id: '321' });
  });

  it('propagates cancellation to an in-flight request', async () => {
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
});