import { ValidationError } from '../errors/index.js';

/** Maximum size accepted for a geocoding query. */
export const MAX_QUERY_LENGTH = 500;

export type NormalizedQuery = {
  /** The canonical query used for provider requests and Address.source. */
  normalized: string;
  /** The caller's query with outer whitespace removed, for callers that need it. */
  original: string;
};

/**
 * Normalize and validate a query at the core boundary.
 *
 * Keeping this here (rather than in an HTTP adapter) also protects direct
 * library users and makes cache identities independent of insignificant
 * whitespace.
 */
export function normalizeQueryWithOriginal(query: unknown): NormalizedQuery {
  if (typeof query !== 'string') {
    throw new ValidationError('q', query, 'must be a string');
  }

  const original = query.trim();
  const normalized = original.replace(/\s+/gu, ' ');

  if (!normalized) {
    throw new ValidationError('q', query, 'must contain a non-empty query');
  }

  if (normalized.length > MAX_QUERY_LENGTH) {
    throw new ValidationError('q', query, `must be at most ${MAX_QUERY_LENGTH} characters`);
  }

  return { normalized, original };
}

/** Normalize and validate a query, returning its canonical form. */
export function normalizeQuery(query: unknown): string {
  return normalizeQueryWithOriginal(query).normalized;
}

/** Normalize a query for case- and Unicode-equivalent cache/deduplication. */
export function normalizeQueryKey(query: unknown): string {
  return normalizeQuery(query).normalize('NFC').toLowerCase();
}