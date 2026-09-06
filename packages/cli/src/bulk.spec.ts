import { describe, expect, it, vi } from 'vitest';
import { type Address } from '../../core/src/index.js';
import { runBulk } from './bulk.js';
import { bulkContinueOnError, createProgram } from './cli.js';

describe('bulk CLI workflow', () => {
  it('deduplicates input, emits NDJSON, and reports progress on stderr', async () => {
    const output: string[] = [];
    const progress: string[] = [];
    const search = vi.fn(
      async (query: string): Promise<Address | null> => ({
        source: query,
        name: query,
        type: 'city',
        confidence: 0,
        country: 'France',
        city: query,
        provider: 'photon'
      })
    );

    const result = await runBulk({
      input: 'Paris\n paris \nBerlin\n',
      geocoder: { search },
      write: (line: string) => output.push(line),
      progress: (line: string) => progress.push(line)
    });

    expect(result).toEqual({ processed: 2, succeeded: 2, failed: 0 });
    expect(search).toHaveBeenCalledTimes(2);
    expect(output.map((line) => JSON.parse(line).query)).toEqual(['Paris', 'Berlin']);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('resumes completed queries and can continue after failures', async () => {
    const output: string[] = [];
    const search = vi.fn(async (query: string): Promise<Address | null> => {
      if (query === 'bad') throw new Error('upstream secret');
      return null;
    });

    const result = await runBulk({
      input: 'DONE\nbad\nnew\n',
      resume: '{"query":"done","ok":true}\n',
      geocoder: { search },
      continueOnError: true,
      write: (line: string) => output.push(line),
      progress: () => undefined
    });

    expect(result).toEqual({ processed: 2, succeeded: 1, failed: 1 });
    expect(search).toHaveBeenCalledTimes(2);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { query: 'bad', ok: false, error: 'Geocoding failed' },
      { query: 'new', ok: true, address: null }
    ]);
  });

  it('allows multiple workers for public Nominatim bulk', async () => {
    let active = 0;
    let maximumActive = 0;
    const search = vi.fn(async (query: string): Promise<Address> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        source: query,
        name: `${query}, France`,
        type: 'city',
        confidence: 0,
        country: 'France',
        city: query,
        provider: 'openstreetmap'
      };
    });

    const result = await runBulk({
      input: 'Paris\nBerlin\n',
      geocoder: { search },
      workers: 2,
      write: () => undefined,
      progress: () => undefined
    });

    expect(result).toEqual({ processed: 2, succeeded: 2, failed: 0 });
    expect(maximumActive).toBe(2);
  });

  it('uses Commander continueOnError and reports pending work in progress', async () => {
    const bulk = createProgram().commands.find((command) => command.name() === 'bulk');
    expect(bulk).toBeDefined();
    expect(bulkContinueOnError({ continueOnError: true })).toBe(true);
    expect(bulkContinueOnError({ continue: true })).toBe(false);

    const progress: string[] = [];
    await runBulk({
      input: 'done\nbad\n',
      resume: '{"query":"done","ok":true}\n',
      geocoder: {
        search: async () => {
          throw new Error('failed');
        }
      },
      continueOnError: true,
      write: () => undefined,
      progress: (line) => progress.push(line)
    });
    expect(progress).toContain('Progress: 1/1');
  });
});