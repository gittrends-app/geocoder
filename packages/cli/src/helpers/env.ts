import { homedir } from 'node:os';
import { resolve } from 'node:path';
import z from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.hostname().default('localhost'),
  NODE_ENV: z.string().default('development'),
  OSM_SERVER: z.string().default('https://nominatim.openstreetmap.org'),
  OSM_EMAIL: z.email().optional(),
  OSM_USER_AGENT: z.string().optional(),
  CACHE_DIR: z.string().default(resolve(homedir(), '.cache', 'gittrends-geocoder')),
  CACHE_SIZE: z.coerce.number().default(1000)
});

export const env = EnvSchema.parse(process.env);
