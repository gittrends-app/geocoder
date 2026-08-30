import { z } from 'zod';

const numericConfidenceString = z
  .string()
  .trim()
  .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u)
  .transform(Number)
  .refine(Number.isFinite);

/** Finite confidence values accepted from provider payloads. */
export const ConfidenceSchema = z.union([z.number().finite(), numericConfidenceString]);

export const AddressSchema = z.preprocess(
  (data: unknown) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== null && value !== undefined)
    );
  },
  z.object({
    source: z.string().trim().min(1).describe('The address to geocode'),
    name: z.string().trim().min(1).describe('The formatted address'),
    type: z.string().trim().min(1).describe('The address type'),
    confidence: ConfidenceSchema.describe('The confidence level'),
    country: z.string().trim().min(1).optional().describe('The country name'),
    country_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,3}$/u)
      .optional()
      .describe('The country code'),
    state: z.string().trim().min(1).optional().describe('The state name'),
    city: z.string().trim().min(1).optional().describe('The city name'),
    provider: z.enum(['openstreetmap', 'photon', 'locationiq']).describe('The geocoding provider')
  })
);

export type Address = z.infer<typeof AddressSchema>;
