import { describe, expect, it } from 'vitest';
import { queueOptions } from './queue.js';

describe('queueOptions', () => {
  it('prefers rate concurrency and falls back to the argument or one', () => {
    expect(queueOptions({ intervalCap: 2, interval: 1000, concurrency: 3 }, 4)).toMatchObject({
      concurrency: 3
    });
    expect(queueOptions({ intervalCap: 2, interval: 1000 }, 4)).toMatchObject({ concurrency: 4 });
    expect(queueOptions({ intervalCap: 2, interval: 1000 })).toMatchObject({ concurrency: 1 });
  });

  it('returns strict one-per-second defaults without rate options', () => {
    expect(queueOptions(undefined)).toEqual({
      concurrency: 1,
      intervalCap: 1,
      interval: 1000,
      strict: true
    });
    expect(queueOptions(undefined, 3)).toEqual({
      concurrency: 3,
      intervalCap: 1,
      interval: 1000,
      strict: true
    });
  });
});