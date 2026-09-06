import { Geocoder, normalizeQuery } from '@/core';
import { parseConcurrency } from './helpers/config.js';

export interface BulkOptions {
  /** Newline-delimited queries, already read from a file or stdin. */
  input: string;
  geocoder: Geocoder;
  /** Previous NDJSON output, already read from a file. */
  resume?: string;
  continueOnError?: boolean;
  workers?: number;
  write: (line: string) => void;
  progress: (line: string) => void;
}

export interface BulkResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Process bulk geocoding from input (file/stdin), with dedup, resume, and NDJSON output.
 */
export async function runBulk(options: BulkOptions): Promise<BulkResult> {
  const {
    input,
    geocoder,
    resume,
    continueOnError = false,
    workers: requestedWorkers = 1,
    write,
    progress
  } = options;

  const workers = parseConcurrency(requestedWorkers);

  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const completed = new Set<string>();

  if (resume) {
    for (const line of resume.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (typeof obj.query === 'string' && obj.ok === true) completed.add(key(obj.query));
      } catch {
        // Skip malformed resume lines
      }
    }
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  const pending = lines.filter((query) => {
    const normalized = key(query);
    if (completed.has(normalized) || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  let next = 0;
  let firstError: unknown;
  const worker = async () => {
    while (firstError === undefined || continueOnError) {
      const index = next++;
      if (index >= pending.length) return;
      const query = pending[index];
      try {
        const address = await geocoder.search(query);
        write(JSON.stringify({ query, ok: true, address }));
        succeeded += 1;
      } catch (error) {
        write(JSON.stringify({ query, ok: false, error: 'Geocoding failed' }));
        failed += 1;
        if (!continueOnError) firstError ??= error;
      } finally {
        processed += 1;
        const remaining = pending.length - processed;
        progress(
          `Progress: ${processed}/${pending.length}${remaining > 0 ? ` (${remaining} pending)` : ''}`
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, pending.length) }, worker));
  if (firstError !== undefined) throw firstError;

  return { processed, succeeded, failed };
}

function key(query: string): string {
  try {
    return normalizeQuery(query).toLocaleLowerCase();
  } catch {
    return query.trim().toLocaleLowerCase();
  }
}