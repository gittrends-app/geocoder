/** Format provider name components without empty or repeated segments. */
export function formatDisplayName(parts: unknown[], fallback = ''): string {
  const values = parts
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(values)].join(', ') || fallback.trim();
}
