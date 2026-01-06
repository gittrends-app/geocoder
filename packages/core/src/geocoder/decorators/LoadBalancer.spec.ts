import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Address } from '../../entities/Address.js';
import { Geocoder } from '../Geocoder.js';
import { LoadBalancer } from './LoadBalancer.js';

describe('LoadBalancer', () => {
  let mockGeocoder1: Geocoder;
  let mockGeocoder2: Geocoder;
  let mockGeocoder3: Geocoder;

  const testAddress: Address = {
    source: 'New York, USA',
    confidence: 0.9,
    name: 'New York, New York, United States',
    type: 'city',
    country: 'United States',
    country_code: 'US',
    city: 'New York'
  };

  beforeEach(() => {
    mockGeocoder1 = {
      search: vi.fn()
    } as unknown as Geocoder;

    mockGeocoder2 = {
      search: vi.fn()
    } as unknown as Geocoder;

    mockGeocoder3 = {
      search: vi.fn()
    } as unknown as Geocoder;

    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw error if no providers are given', () => {
      expect(() => new LoadBalancer([])).toThrow(
        'LoadBalancer requires at least one geocoder provider'
      );
    });

    it('should initialize with providers', () => {
      const loadBalancer = new LoadBalancer([mockGeocoder1]);
      expect(loadBalancer).toBeDefined();
    });

    it('should initialize with multiple providers', () => {
      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);
      expect(loadBalancer).toBeDefined();
    });
  });

  describe('search', () => {
    it('should resolve request with provider', async () => {
      vi.mocked(mockGeocoder1.search).mockResolvedValue(testAddress);

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);
      const result = await loadBalancer.search('New York, USA');

      expect(result).toEqual(testAddress);
    });

    it('should handle providers returning successful results', async () => {
      vi.mocked(mockGeocoder1.search).mockResolvedValue(testAddress);

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);
      const result = await loadBalancer.search('Unknown Location');

      expect(result).toEqual(testAddress);
    });

    it('should use fallback when one provider fails', async () => {
      vi.mocked(mockGeocoder1.search).mockResolvedValue(null);
      vi.mocked(mockGeocoder2.search).mockResolvedValue(testAddress);

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);
      const result = await loadBalancer.search('Unknown Location');

      expect(result).toEqual(testAddress);
    });

    it('should return null when all providers fail', async () => {
      vi.mocked(mockGeocoder1.search).mockResolvedValue(null);
      vi.mocked(mockGeocoder2.search).mockResolvedValue(null);

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);
      const result = await loadBalancer.search('Unknown Location');

      expect(result).toBeNull();
      expect(mockGeocoder1.search).toHaveBeenCalledTimes(1);
      expect(mockGeocoder2.search).toHaveBeenCalledTimes(1);
    });

    it('should pass through abort signal to provider', async () => {
      const abortController = new AbortController();
      vi.mocked(mockGeocoder1.search).mockResolvedValueOnce(testAddress);

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);
      await loadBalancer.search('New York, USA', { signal: abortController.signal });

      expect(mockGeocoder1.search).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(mockGeocoder1.search).mock.calls[0];
      expect(callArgs[0]).toBe('New York, USA');
      expect(callArgs[1]?.signal).toBe(abortController.signal);
    });
  });

  describe('lowest queue size distribution', () => {
    it('should select provider with lowest queue size', async () => {
      // Make provider 1 slow to build up its queue
      let resolveProvider1: (value: Address) => void;
      const provider1Promise = new Promise<Address>((resolve) => {
        resolveProvider1 = resolve;
      });

      vi.mocked(mockGeocoder1.search).mockReturnValueOnce(provider1Promise);
      vi.mocked(mockGeocoder2.search).mockResolvedValue(testAddress);

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);

      // First request goes to provider 1 (both have queue size 0)
      const request1 = loadBalancer.search('Query 1');

      // Wait a bit for first request to start processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second request should go to provider 2 (provider 1 is busy)
      await loadBalancer.search('Query 2');

      expect(mockGeocoder1.search).toHaveBeenCalledTimes(1);
      expect(mockGeocoder2.search).toHaveBeenCalledTimes(1);

      // Clean up
      resolveProvider1!(testAddress);
      await request1;
    });

    it('should distribute to same provider when all queues are empty', async () => {
      vi.mocked(mockGeocoder1.search).mockResolvedValue(testAddress);
      vi.mocked(mockGeocoder2.search).mockResolvedValue(testAddress);

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);

      // When all queues are empty (size 0), first provider is selected each time
      await loadBalancer.search('Query 1');
      await loadBalancer.search('Query 2');

      // Both should go to provider 1 since queues drain immediately
      expect(mockGeocoder1.search).toHaveBeenCalledTimes(2);
      expect(mockGeocoder2.search).toHaveBeenCalledTimes(0);
    });
  });

  describe('concurrent requests', () => {
    it('should handle concurrent requests', async () => {
      vi.mocked(mockGeocoder1.search).mockResolvedValue(testAddress);
      vi.mocked(mockGeocoder2.search).mockResolvedValue({ ...testAddress, source: 'Query 2' });

      const loadBalancer = new LoadBalancer([mockGeocoder1, mockGeocoder2]);

      const [result1, result2] = await Promise.all([
        loadBalancer.search('New York, USA'),
        loadBalancer.search('London, UK')
      ]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it('should queue requests when provider is at concurrency limit', async () => {
      let resolve1: (value: Address) => void;
      let resolve2: (value: Address) => void;
      const promise1 = new Promise<Address>((resolve) => {
        resolve1 = resolve;
      });
      const promise2 = new Promise<Address>((resolve) => {
        resolve2 = resolve;
      });

      vi.mocked(mockGeocoder1.search).mockReturnValueOnce(promise1).mockReturnValueOnce(promise2);

      const loadBalancer = new LoadBalancer([mockGeocoder1]);

      // Start 2 requests
      const request1 = loadBalancer.search('Query 1');
      const request2 = loadBalancer.search('Query 2');

      // Wait a bit for processing to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Resolve first request
      resolve1!(testAddress);
      await request1;

      // Resolve second request
      resolve2!({ ...testAddress, source: 'Query 2' });

      // Second request should complete
      await expect(request2).resolves.toBeDefined();
    });
  });
});
