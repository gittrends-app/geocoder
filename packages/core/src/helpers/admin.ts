export type AdminLevel = 'country' | 'state' | 'county' | 'city';

const levels: Record<string, AdminLevel> = {
  country: 'country',
  state: 'state',
  region: 'state',
  province: 'state',
  state_district: 'county',
  county: 'county',
  city: 'city',
  town: 'city',
  village: 'city',
  municipality: 'city',
  hamlet: 'city'
};

/** Return the first recognized administrative level in provider signals. */
export function adminLevel(...signals: unknown[]): AdminLevel | undefined {
  for (const signal of signals) {
    if (typeof signal !== 'string') continue;
    const level = levels[signal.trim().toLowerCase()];
    if (level) return level;
  }
  return undefined;
}

type AdminRaw = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Normalize provider address components and backfill the matched feature. */
export function adminFields(
  level: AdminLevel,
  featureName: unknown,
  raw: AdminRaw
): {
  name: string;
  country?: string;
  country_code?: string;
  state?: string;
  city?: string;
} {
  const country = text(raw.country);
  const state = text(raw.state) ?? text(raw.region) ?? text(raw.province);
  const city =
    text(raw.city) ??
    text(raw.town) ??
    text(raw.village) ??
    text(raw.municipality) ??
    text(raw.hamlet);
  const matched = text(featureName);

  const fields = {
    country: level === 'country' ? (country ?? matched) : country,
    country_code: text(raw.country_code) ?? text(raw.countrycode),
    state: level === 'state' ? (state ?? matched) : state,
    city: level === 'city' ? (city ?? matched) : city
  };

  return {
    name: [...new Set([fields.city, fields.state, fields.country].filter(Boolean))].join(', '),
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  } as {
    name: string;
    country?: string;
    country_code?: string;
    state?: string;
    city?: string;
  };
}