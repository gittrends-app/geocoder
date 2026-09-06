import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import { MAX_QUERY_LENGTH, normalizeQuery, normalizeQueryWithOriginal } from './query.js';

describe('query normalization', () => {
  it('trims and collapses whitespace while retaining the trimmed input', () => {
    expect(normalizeQueryWithOriginal('  New\tYork\n USA  ')).toEqual({
      normalized: 'New York USA',
      original: 'New\tYork\n USA'
    });
    expect(normalizeQuery('  New\tYork  ')).toBe('New York');
  });

  it.each(['', '  ', '\n\t'])('rejects an empty query (%j)', (query) => {
    expect(() => normalizeQuery(query)).toThrow(ValidationError);
  });

  it('rejects queries over the core limit', () => {
    expect(() => normalizeQuery('x'.repeat(MAX_QUERY_LENGTH + 1))).toThrow(ValidationError);
  });

  it('rejects non-string input at runtime', () => {
    expect(() => normalizeQuery(null)).toThrow(ValidationError);
  });
});