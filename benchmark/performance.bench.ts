import { bench, describe } from 'vitest';

type Item = { importance?: number; category?: string };

function generateMockResults(n = 100): Item[] {
  const categories = ['place', 'boundary', 'street', 'other'];
  return Array.from({ length: n }, (_, i) => ({
    importance: Math.random(),
    category: categories[i % categories.length]
  }));
}

describe('Array filtering performance', () => {
  const data = generateMockResults(100);

  bench('original (3-pass)', () => {
    const result = data
      .filter((r) => r.importance && r.importance >= 0.5)
      .filter((r) => ['place', 'boundary'].includes(r.category!))
      .reduce(
        (best, curr) => (!best || curr.importance! > best.importance! ? curr : best),
        undefined as Item | undefined
      );
  });

  bench('optimized (1-pass)', () => {
    const result = data.reduce(
      (best, curr) => {
        if (!curr.importance || curr.importance < 0.5) return best;
        if (!['place', 'boundary'].includes(curr.category!)) return best;
        if (!best) return curr;
        return curr.importance! > best.importance! ? curr : best;
      },
      undefined as Item | undefined
    );
  });
});
