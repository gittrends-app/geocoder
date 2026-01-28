import path from 'node:path';
import fastifyTraps from '@dnlup/fastify-traps';
import helmet from '@fastify/helmet';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import fastify, { FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider
} from 'fastify-type-provider-zod';
import { KeyvFile } from 'keyv-file';
import { z } from 'zod';
import {
  AddressSchema,
  Cache,
  Fallback,
  Geocoder,
  OpenStreetMap,
  OpenStreetMapOptions,
  Photon
} from '@/core';
import pJson from '../package.json' with { type: 'json' };

// Module-level regex constants to avoid per-request compilation
const NORMALIZE_COMMA = /[,]/g;
const NORMALIZE_WHITESPACE = /\s+/g;

type AppOptions = {
  // Accept either geocoder options to construct providers or a ready-made Geocoder (useful for tests)
  geocoder: OpenStreetMapOptions | Geocoder;
  cache?: Partial<{ dirname: string; size: number }>;
  debug?: boolean;
  rateLimit?: { max?: number; timeWindow?: string; redis?: string };
  helmet?: { enabled?: boolean };
};

/**
 * Create a new Fastify instance
 *
 * @returns {FastifyInstance} - The Fastify instance
 */
export function createApp(options: AppOptions): FastifyInstance {
  const app = fastify({ logger: options.debug });

  // Handle signals and timeouts
  app.register(fastifyTraps);

  // Register security headers (helmet) before other middleware
  // Default: helmet disabled unless explicitly enabled in options
  const HELMET_ENABLED = options.helmet?.enabled === true;
  if (HELMET_ENABLED && process.env.NODE_ENV !== 'test') {
    app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
          connectSrc: ["'self'"]
        }
      },
      crossOriginEmbedderPolicy: false,
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
    });
  }

  // Add schema validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register simple in-memory rate limiter BEFORE routes
  if (options.rateLimit) {
    const max = options.rateLimit?.max ?? 100;
    const timeWindow = options.rateLimit?.timeWindow ?? '1 minute';

    const parseWindow = (tw: string) => {
      const s = tw.toLowerCase().trim();
      if (s.includes('minute')) return 60_000;
      if (s.includes('second')) return 1_000;
      if (s.includes('hour')) return 3_600_000;
      const n = Number(s);
      return Number.isFinite(n) ? n : 60_000;
    };

    const windowMs = parseWindow(timeWindow);
    const store = new Map<string, { count: number; reset: number }>();

    app.addHook('onRequest', async (req, reply) => {
      try {
        const key = (req.headers['x-forwarded-for'] as string) || String(req.ip || 'unknown');
        const now = Date.now();
        const entry = store.get(key);
        // increment hits
        if (!entry || now > entry.reset) {
          store.set(key, { count: 1, reset: now + windowMs });
        } else {
          entry.count += 1;
          store.set(key, entry);
          if (entry.count > max) {
            reply.code(429).send({
              statusCode: 429,
              error: 'Too Many Requests',
              message: `Rate limit exceeded. Try again after ${Math.round((entry.reset - now) / 1000)} seconds.`,
              retryAfter: Math.round((entry.reset - now) / 1000)
            });
          }
        }
      } catch (err: unknown) {
        // On error, do not block the request; fail-open
        app.log.warn('rate-limiter error: %o', { error: String(err) });
      }
    });
  }

  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'GitTrends Geocoder',
        description: 'Geocode github users location',
        version: pJson.version
      }
    },
    transform: jsonSchemaTransform
  });

  app.register(fastifySwaggerUI, {
    routePrefix: '/docs'
  });

  // Add security headers via onSend hook when helmet is not enabled or to ensure
  // a minimal set of headers is always present. Keep this disabled in tests.
  const HEADERS_ENABLED = HELMET_ENABLED || process.env.NODE_ENV !== 'test';
  if (HEADERS_ENABLED) {
    app.addHook('onSend', async (req, reply, payload) => {
      try {
        // HSTS: only set when running in production over HTTPS (best-effort)
        if (process.env.NODE_ENV === 'production') {
          reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }

        reply.header('X-Frame-Options', 'SAMEORIGIN');
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

        // Minimal CSP allowing Swagger UI to function and images from validator
        reply.header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: validator.swagger.io; connect-src 'self'"
        );
      } catch (err: unknown) {
        app.log.warn('failed to set security headers: %o', { error: String(err) });
      }
      return payload;
    });
  }

  let geocoder: Geocoder;
  // If a Geocoder instance is provided directly, use it (helps testing). Otherwise build from options.
  if (
    (options.geocoder as Geocoder) &&
    typeof (options.geocoder as Geocoder).search === 'function'
  ) {
    geocoder = options.geocoder as Geocoder;
  } else {
    const opts = options.geocoder as OpenStreetMapOptions;
    geocoder = new Fallback(new OpenStreetMap(opts), new Photon(opts));
  }

  if (options.cache && options.cache.size) {
    geocoder = new Cache(geocoder, {
      namespace: 'geocoder-cache-cli',
      size: options.cache.size,
      secondary: options.cache.dirname
        ? new KeyvFile({ filename: path.resolve(options.cache.dirname, 'geocoder-cache.json') })
        : undefined
    });
  }

  app.after(async () => {
    app.get('/', async (req, res) => {
      res.redirect('/docs');
    });

    app.withTypeProvider<ZodTypeProvider>().route({
      method: 'GET',
      url: '/search',
      schema: {
        tags: ['Geocoder'],
        summary: 'Geocode an address',
        querystring: z.object({
          q: z.string().min(1).max(500).describe('The address to geocode')
        }),
        response: {
          200: AddressSchema,
          404: z.object({ message: z.string().describe('Address not found') })
        }
      },
      handler: async (req, res) => {
        const controller = new AbortController();
        req.raw.on('close', () => controller.abort('Request aborted'));
        // Runtime normalization and additional validation beyond Zod
        const rawQ = String(req.query.q ?? '');
        const normalized = rawQ
          .toLowerCase()
          .trim()
          .replace(NORMALIZE_COMMA, '')
          .replace(NORMALIZE_WHITESPACE, ' ');

        // Reject empty after normalization
        if (!normalized || normalized.length === 0) {
          return res
            .status(400)
            .send({ message: 'q must contain a non-empty address after normalization' });
        }

        // Explicitly reject URL-like inputs
        if (normalized.includes('http://') || normalized.includes('https://')) {
          return res.status(400).send({ message: 'q must not contain URLs' });
        }

        // Allowed characters: letters, numbers, whitespace, and common punctuation
        const ALLOWED_RE = /^[\p{L}\p{N}\s,.'"\-()\/:&]+$/u;
        if (!ALLOWED_RE.test(normalized)) {
          return res.status(400).send({ message: 'q contains invalid characters' });
        }

        const q = normalized;
        const address = await geocoder.search(q, { signal: controller.signal });
        if (address) res.send(address);
        else res.status(404).send({ message: 'Address not found' });
      }
    });
  });

  return app;
}
