import { describe, expect, it, vi } from 'vitest';
import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';
import { Fallback } from './Fallback.js';

describe('Fallback', () => {
  const mockAddress = {} as Address;

  it('should return address from primary geocoder', async () => {
    const primaryGeocoder = {
      search: vi.fn().mockResolvedValue(mockAddress)
    } as unknown as Geocoder;

    const fallbackGeocoder = {
      search: vi.fn()
    } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    const result = await fallback.search('query');

    expect(result).toBe(mockAddress);
    expect(primaryGeocoder.search).toHaveBeenCalledWith('query', undefined);
    expect(fallbackGeocoder.search).not.toHaveBeenCalled();
  });

  it('should return address from fallback geocoder if primary returns null', async () => {
    const primaryGeocoder = {
      search: vi.fn().mockResolvedValue(null)
    } as unknown as Geocoder;

    const fallbackGeocoder = {
      search: vi.fn().mockResolvedValue(mockAddress)
    } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    const result = await fallback.search('query');

    expect(result).toBe(mockAddress);
    expect(primaryGeocoder.search).toHaveBeenCalledWith('query', undefined);
    expect(fallbackGeocoder.search).toHaveBeenCalledWith('query', undefined);
  });

  it('should return null if both geocoders return null', async () => {
    const primaryGeocoder = {
      search: vi.fn().mockResolvedValue(null)
    } as unknown as Geocoder;

    const fallbackGeocoder = {
      search: vi.fn().mockResolvedValue(null)
    } as unknown as Geocoder;

    const fallback = new Fallback(primaryGeocoder, fallbackGeocoder);
    const result = await fallback.search('query');

    expect(result).toBeNull();
    expect(primaryGeocoder.search).toHaveBeenCalledWith('query', undefined);
    expect(fallbackGeocoder.search).toHaveBeenCalledWith('query', undefined);
  });
});
