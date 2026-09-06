import { z } from 'zod';

/** Finite confidence values accepted from provider payloads. */
export const ConfidenceSchema = z
  .union([z.number(), z.string().trim().min(1).transform(Number)])
  .pipe(z.number().finite());
const CoordinateSchema = z.number().finite();
const BoundingBoxSchema = z.tuple([
  CoordinateSchema,
  CoordinateSchema,
  CoordinateSchema,
  CoordinateSchema
]);

export const AddressSchema = z
  .object({
    source: z.string().trim().min(1).describe('The address to geocode'),
    name: z.string().trim().min(1).describe('The formatted address'),
    type: z.string().trim().min(1).describe('The address type'),
    confidence: ConfidenceSchema.describe('The confidence level'),
    /** Provider score when the provider exposes one; it is not a probability. */
    score: ConfidenceSchema.optional(),
    latitude: CoordinateSchema.optional(),
    longitude: CoordinateSchema.optional(),
    bbox: BoundingBoxSchema.optional(),
    source_id: z.string().trim().min(1).optional(),
    provenance: z.string().trim().min(1).optional(),
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
  .refine((data) => Boolean(data.city ?? data.state ?? data.country), {
    message: 'At least one administrative field is required'
  });

export type Address = z.infer<typeof AddressSchema>;
