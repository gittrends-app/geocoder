import { describe, expect, it } from 'vitest';
import { adminFields, adminLevel } from './admin.js';

describe('administrative helpers', () => {
  it.each([
    ['country', 'country'],
    ['region', 'state'],
    ['province', 'state'],
    ['state_district', 'county'],
    ['county', 'county'],
    ['town', 'city'],
    ['village', 'city'],
    ['municipality', 'city'],
    ['hamlet', 'city']
  ])('recognizes %s as %s', (signal, expected) => {
    expect(adminLevel(signal)).toBe(expected);
  });

  it('backfills a matched feature without promoting counties', () => {
    expect(adminFields('state', 'Texas', { country: 'United States' })).toEqual({
      name: 'Texas, United States',
      country: 'United States',
      country_code: undefined,
      state: 'Texas',
      city: undefined
    });
    expect(adminFields('county', 'Travis County', { country: 'United States' })).toEqual({
      name: 'United States',
      country: 'United States',
      country_code: undefined,
      state: undefined,
      city: undefined
    });
    expect(
      adminFields('county', 'Travis District', {
        country: 'United States',
        state_district: 'Travis District'
      })
    ).toEqual({
      name: 'United States',
      country: 'United States',
      country_code: undefined,
      state: undefined,
      city: undefined
    });
  });
});
