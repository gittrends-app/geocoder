import { homedir } from 'node:os';
import { resolve } from 'node:path';
import z from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('localhost'),
  NODE_ENV: z.string().default('development'),
  CACHE_DIR: z.string().default(resolve(homedir(), '.cache', 'gittrends-geocoder')),
  CACHE_SIZE: z.coerce.number().default(1000)
});

export const env = EnvSchema.parse(process.env);
