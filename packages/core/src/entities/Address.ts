import { z } from 'zod';

export const AddressSchema = z.preprocess(
  (data: any) =>
    Object.fromEntries(
      Object.entries(data).filter(([, value]) => ![null, undefined].includes(value as any))
    ),
  z.object({
    source: z.string().describe('The address to geocode'),
    name: z.string().describe('The formatted address'),
    type: z.string().describe('The address type'),
    confidence: z.coerce.number().describe('The confidence level'),
    country: z.string().optional().describe('The country name'),
    country_code: z.string().optional().describe('The country code'),
    state: z.string().optional().describe('The state name'),
    city: z.string().optional().describe('The city name')
  })
);

export type Address = z.infer<typeof AddressSchema>;
