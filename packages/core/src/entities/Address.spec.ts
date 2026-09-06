import { describe, expect, it } from 'vitest';
import { AddressSchema } from './Address.js';

describe('AddressSchema', () => {
  it('does not throw for malformed non-object input', () => {
    expect(AddressSchema.safeParse(null).success).toBe(false);
    expect(AddressSchema.safeParse('not an address').success).toBe(false);
  });

  it('rejects empty required values and malformed country codes', () => {
    const result = AddressSchema.safeParse({
      source: 'query',
      name: ' ',
      type: 'city',
      confidence: 0,
      country_code: 'not-a-code',
      provider: 'photon'
    });

    expect(result.success).toBe(false);
  });

  it.each([false, '', [], [0], {}, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects malformed confidence value %j',
    (confidence) => {
      const result = AddressSchema.safeParse({
        source: 'query',
        name: 'Place',
        type: 'city',
        confidence,
        provider: 'photon'
      });

      expect(result.success).toBe(false);
    }
  );

  it('accepts a finite numeric confidence string for provider compatibility', () => {
    const result = AddressSchema.safeParse({
      source: 'query',
      name: 'Place',
      type: 'city',
      confidence: '0.75',
      country: 'France',
      provider: 'photon'
    });

    expect(result.success && result.data.confidence).toBe(0.75);
  });

  it('requires at least one administrative field', () => {
    expect(
      AddressSchema.safeParse({
        source: 'query',
        name: 'Place',
        type: 'city',
        confidence: 0,
        provider: 'photon'
      }).success
    ).toBe(false);
    expect(
      AddressSchema.safeParse({
        source: 'query',
        name: 'France',
        type: 'country',
        confidence: 0,
        country: 'France',
        provider: 'photon'
      }).success
    ).toBe(true);
  });
});