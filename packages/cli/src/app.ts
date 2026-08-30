import path from 'node:path';
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
  GeocoderError,
  MAX_QUERY_LENGTH,
  normalizeQuery,
  OpenStreetMap,
  OpenStreetMapOptions,
  Photon,
  RequestAbortedError,
  ValidationError
} from '@/core';
import pJson from '../package.json' with { type: 'json' };
import {
  DEFAULT_OSM_SERVER,
  isDefaultNominatimServer,
  MAX_RATE_LIMIT_ENTRIES,
  normalizeOsmServerUrl,
  parseCacheSize,
  parseRateLimitMax,
  parseRateLimitWindow,
  validateCacheDirectory,
  validateEmail,
  validateUserAgent
} from './helpers/config.js';

const disallowedQueryControls = /[\u0000-\u001F\u007F-\u009F]/u;

export function normalizeSearchQuery(query: unknown): string {
  if (typeof query === 'string' && disallowedQueryControls.test(query)) {
    throw new ValidationError('q', query, 'must not contain control characters');
  }
  return normalizeQuery(query);
}

type AppOptions = {
  // Accept either geocoder options to construct providers or a ready-made Geocoder (useful for tests)
  geocoder: OpenStreetMapOptions | Geocoder;
  cache?: Partial<{ dirname: string; size: number }>;
  debug?: boolean;
  rateLimit?: { max?: number; timeWindow?: string; redis?: string; maxKeys?: number };
  helmet?: { enabled?: boolean };
};

/**
 * Create a new Fastify instance
 *
 * @returns {FastifyInstance} - The Fastify instance
 */
export function createApp(options: AppOptions): FastifyInstance {
  const injectedGeocoder =
    !!options.geocoder && typeof (options.geocoder as Geocoder).search === 'function';
  const providerOptions = injectedGeocoder
    ? undefined
    : (() => {
        const provider = options.geocoder as OpenStreetMapOptions;
        return {
          ...provider,
          osmServer: normalizeOsmServerUrl(provider.osmServer ?? DEFAULT_OSM_SERVER),
          email: validateEmail(provider.email),
          userAgent: validateUserAgent(provider.userAgent)
        };
      })();
  if (
    providerOptions &&
    isDefaultNominatimServer(providerOptions.osmServer) &&
    (!providerOptions.email || !providerOptions.userAgent)
  ) {
    throw new ValidationError(
      'OSM_SERVER',
      providerOptions.osmServer,
      'default Nominatim requires OSM_EMAIL and OSM_USER_AGENT'
    );
  }
  const cacheOptions = options.cache
    ? {
        dirname: validateCacheDirectory(options.cache.dirname),
        size: options.cache.size === undefined ? undefined : parseCacheSize(options.cache.size)
      }
    : undefined;

  const app = fastify({ logger: options.debug, trustProxy: false });

  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url }, 'request failed');
    if (reply.sent) return;
    if (
      error instanceof RequestAbortedError ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      return reply.code(499).send({ message: 'Request aborted' });
    }
    if (error instanceof ValidationError || (error as { validation?: unknown }).validation) {
      return reply.code(400).send({ message: 'Invalid request' });
    }
    if (error instanceof GeocoderError) {
      return reply.code(502).send({ message: 'Geocoding service unavailable' });
    }
    if (request.routeOptions.url === '/search') {
      return reply.code(502).send({ message: 'Geocoding service unavailable' });
    }
    return reply.code(500).send({ message: 'Internal server error' });
  });

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
    if (options.rateLimit.redis !== undefined) {
      throw new ValidationError(
        'rateLimit.redis',
        options.rateLimit.redis,
        'Redis support is not configured'
      );
    }
    const max = parseRateLimitMax(options.rateLimit.max ?? 100);
    const windowMs = parseRateLimitWindow(options.rateLimit.timeWindow ?? '1 minute');
    const maxKeys =
      options.rateLimit.maxKeys !== undefined
        ? parseRateLimitMax(options.rateLimit.maxKeys)
        : MAX_RATE_LIMIT_ENTRIES;
    const store = new Map<string, { count: number; reset: number; lastSeen: number }>();
    let cleanupCursor = store.entries();
    const cleanupExpired = () => {
      const now = Date.now();
      let checked = 0;
      while (checked < 100) {
        const next = cleanupCursor.next();
        if (next.done) {
          cleanupCursor = store.entries();
          return;
        }
        checked += 1;
        if (next.value[1].reset <= now) store.delete(next.value[0]);
      }
    };
    const cleanupTimer = setInterval(cleanupExpired, Math.min(Math.max(windowMs, 1_000), 60_000));
    cleanupTimer.unref();
    app.addHook('onClose', async () => clearInterval(cleanupTimer));

    app.addHook('onRequest', async (req, reply) => {
      try {
        if (req.url.split('?')[0] === '/health/live') return;
        const key = String(req.ip || 'unknown');
        const now = Date.now();
        let entry = store.get(key);
        if (entry && entry.reset <= now) {
          store.delete(key);
          entry = undefined;
        }
        // increment hits
        if (!entry) {
          if (!entry && store.size >= maxKeys) {
            const oldestKey = store.keys().next().value;
            if (oldestKey !== undefined) store.delete(oldestKey);
          }
          store.set(key, { count: 1, reset: now + windowMs, lastSeen: now });
        } else {
          entry.count += 1;
          entry.lastSeen = now;
          // Map insertion order is the bounded LRU order.
          store.delete(key);
          store.set(key, entry);
          if (entry.count > max) {
            return reply.code(429).send({
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
  if (injectedGeocoder) {
    geocoder = options.geocoder as Geocoder;
  } else {
    const opts = providerOptions as OpenStreetMapOptions;
    geocoder = new Fallback(new OpenStreetMap(opts), new Photon(opts));
  }
  const healthGeocoder = geocoder;

  if (cacheOptions?.size) {
    geocoder = new Cache(geocoder, {
      namespace: 'geocoder-cache-cli',
      size: cacheOptions.size,
      secondary: cacheOptions.dirname
        ? new KeyvFile({ filename: path.resolve(cacheOptions.dirname, 'geocoder-cache.json') })
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
        querystring: z
          .object({
            q: z.string().min(1).max(MAX_QUERY_LENGTH).describe('The address to geocode')
          })
          .strict(),
        response: {
          200: AddressSchema,
          400: z.object({ message: z.string().describe('Bad request') }),
          404: z.object({ message: z.string().describe('Address not found') })
        }
      },
      handler: async (req, res) => {
        const controller = new AbortController();
        req.raw.once('close', () => controller.abort('Request aborted'));
        let normalized: string;
        try {
          normalized = normalizeSearchQuery(req.query.q);
        } catch (error) {
          if (error instanceof ValidationError) {
            const message = error.constraint.includes('non-empty')
              ? 'q must contain a non-empty address after normalization'
              : error.constraint.includes('control')
                ? 'q contains invalid control characters'
                : error.constraint.includes('at most')
                  ? `q must not exceed ${MAX_QUERY_LENGTH} characters`
                  : 'q must be a string';
            return res.status(400).send({ message });
          }
          throw error;
        }

        const address = await geocoder.search(normalized, { signal: controller.signal });
        if (address) res.send(address);
        else res.status(404).send({ message: 'Address not found' });
      }
    });

    // Health endpoints
    app.get('/health', async (req, res) => {
      const health: Record<string, unknown> = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      };

      try {
        // Quick check to see if geocoding works
        const testResult = await healthGeocoder.search('test', {
          signal: AbortSignal.timeout(1000)
        });
        if (testResult) health.status = 'healthy';
        else {
          health.status = 'degraded';
          res.status(503);
        }
      } catch {
        health.status = 'degraded';
        res.status(503);
      }

      res.send(health);
    });

    app.get('/health/ready', async (req, res) => {
      try {
        const result = await healthGeocoder.search('test', { signal: AbortSignal.timeout(1000) });
        if (result) res.status(200).send({ ready: true });
        else res.status(503).send({ ready: false });
      } catch {
        res.status(503).send({ ready: false });
      }
    });

    app.get('/health/live', async (req, res) => {
      res.status(200).send({ alive: true });
    });
  });

  return app;
}
