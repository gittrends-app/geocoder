import { z } from 'zod';

export const AddressSchema = z.object({
  source: z.string().describe('The address to geocode'),
  country: z.string().describe('The country name'),
  country_code: z.string().describe('The country code'),
  state: z.string().optional().describe('The state name'),
  city: z.string().optional().describe('The city name')
});

export type Address = z.infer<typeof AddressSchema>;
