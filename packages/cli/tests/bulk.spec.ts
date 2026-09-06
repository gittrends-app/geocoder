import { describe, expect, it, vi } from 'vitest';
import { type Address } from '../../core/src/index.js';
import { runBulk } from '../src/bulk.js';
import { bulkContinueOnError, createProgram } from '../src/cli.js';

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
        provider: 'photon'
      })
    );

    const result = await runBulk({
      input: 'Paris\n paris \nBerlin\n',
      geocoder: { search },
      rateProfile: 'self-hosted',
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
      input: 'done\nbad\nnew\n',
      resume: '{"query":"done","ok":true}\n',
      geocoder: { search },
      rateProfile: 'self-hosted',
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

  it('requires the safe public Nominatim bulk policy', async () => {
    await expect(
      runBulk({
        input: 'Paris\n',
        geocoder: { search: async () => null },
        providers: ['osm'],
        rateProfile: 'public',
        workers: 2,
        write: () => undefined,
        progress: () => undefined
      })
    ).rejects.toThrow('one worker');
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
      geocoder: { search: async () => { throw new Error('failed'); } },
      rateProfile: 'self-hosted',
      continueOnError: true,
      write: () => undefined,
      progress: (line) => progress.push(line)
    });
    expect(progress).toContain('Progress: 1/1');
  });
});
