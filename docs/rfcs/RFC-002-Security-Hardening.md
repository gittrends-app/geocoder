# RFC-002: Security Hardening

- **Status**: 🔴 Draft
- **Priority**: P0 (Critical)
- **Author**: Code Analysis Agent
- **Created**: 2026-01-27
- **Updated**: 2026-01-27
 - **Updated**: 2026-01-28

## Implementation summary

The following items from this RFC have been implemented and validated in the repository:

- input-validation — feat/security/rfc-002-input-validation (commit: cab8ffc)
- security-headers — feat/security/rfc-002-security-headers (commit: 8d9b36b)
- rate-limit — feat/security/rfc-002-input-validation (commit: cab8ffc)
- docs & CI workflow — main (commit: c67bbfe)
- dependency-fix — feat/security/rfc-002-input-validation (commit: cab8ffc)
- monitoring-metrics — cancelled (branch discarded / deferred)

See SECURITY.md and .github/workflows/security.yml for the published policy and CI checks.

- **Status**: 🟢 Implemented

## Executive Summary

This RFC addresses critical security vulnerabilities in the geocoding service that expose it to DoS attacks, input injection, and security policy violations. These issues must be resolved before production deployment.

## Problem Statement

### Critical Security Issues

1. **No Rate Limiting** (CVE Risk: Medium-High)
   - Location: `packages/cli/src/app.ts` - `/search` endpoint
   - Impact: Single IP can overwhelm service and violate Nominatim API usage policy
   - Risk: Service disruption, IP ban from upstream APIs

2. **Missing Input Validation** (CVE Risk: Medium)
   - Location: Query parameter handling across all geocoding services
   - Impact: Extremely long queries (100MB+) cause memory exhaustion
   - Risk: DoS via memory exhaustion

3. **Missing Security Headers** (CVE Risk: Low-Medium)
   - Location: Fastify application configuration
   - Impact: Vulnerable to XSS, clickjacking, MIME sniffing attacks
   - Risk: Client-side exploitation

4. **Missing Dependency Security**
   - Location: `packages/core/package.json`
   - Impact: Runtime dependencies listed in devDependencies
   - Risk: Missing dependencies in production builds

### Security Policy Violations

5. **Nominatim Usage Policy Violation**
   - No rate limiting = risk of IP ban
   - Missing contact information in User-Agent (partially addressed)
   - Bulk requests without proper throttling

## Proposed Solution

### 1. Add Rate Limiting (P0 - Critical)

**Install Dependency**:
```bash
yarn add @fastify/rate-limit
```

**Implementation** (`packages/cli/src/app.ts`):
```typescript
import rateLimit from '@fastify/rate-limit';

export function createApp(options: AppOptions): FastifyInstance {
  const app = fastify({ logger: options.debug });

  // Handle signals and timeouts
  app.register(fastifyTraps);

  // Add rate limiting BEFORE routes
  app.register(rateLimit, {
    max: 100,                    // Maximum 100 requests
    timeWindow: '1 minute',      // Per 1 minute window
    cache: 10000,                // Track up to 10k IPs
    allowList: ['127.0.0.1'],   // Exclude localhost for testing
    redis: options.redis,        // Optional: use Redis for distributed rate limiting
    keyGenerator: (req) => {     // Use X-Forwarded-For if behind proxy
      return req.headers['x-forwarded-for'] as string || req.ip;
    },
    errorResponseBuilder: (req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${context.ttl} seconds.`,
      retryAfter: context.ttl
    })
  });

  // ... rest of app configuration
}
```

**Configuration** (Add to AppOptions):
```typescript
type AppOptions = {
  geocoder: OpenStreetMapOptions;
  cache?: Partial<{ dirname: string; size: number }>;
  rateLimit?: {
    max: number;
    timeWindow: string;
    redis?: RedisOptions;
  };
  debug?: boolean;
};
```

**Benefits**:
- Prevents DoS attacks
- Complies with Nominatim usage policy
- Protects service from abuse
- Configurable per deployment environment

### 2. Add Input Validation (P0 - Critical)

**Schema Update** (`packages/cli/src/app.ts:87-89`):
```typescript
querystring: z.object({
  q: z
    .string()
    .min(1, 'Query must not be empty')
    .max(500, 'Query must not exceed 500 characters')
    .regex(/^[\w\s,.-]+$/, 'Query contains invalid characters')
    .describe('The address to geocode')
})
```

**Additional Validation** (in handler):
```typescript
handler: async (req, res) => {
  const controller = new AbortController();
  req.raw.on('close', () => controller.abort('Request aborted'));
  
  // Normalize and validate query
  let q = req.query.q.toLowerCase().trim();
  
  // Additional security checks
  if (q.length === 0) {
    return res.status(400).send({ 
      message: 'Query cannot be empty after normalization' 
    });
  }
  
  // Normalize whitespace and punctuation
  q = q.replace(NORMALIZE_COMMA, '').replace(NORMALIZE_WHITESPACE, ' ');
  
  // Prevent URL injection
  if (q.includes('http://') || q.includes('https://')) {
    return res.status(400).send({ 
      message: 'Query cannot contain URLs' 
    });
  }
  
  const address = await geocoder.search(q, { signal: controller.signal });
  if (address) res.send(address);
  else res.status(404).send({ message: 'Address not found' });
}
```

**Benefits**:
- Prevents memory exhaustion DoS
- Blocks injection attacks
- Validates input at API boundary
- Clear error messages for debugging

### 3. Add Security Headers (P0 - Critical)

**Install Dependency**:
```bash
yarn add @fastify/helmet
```

**Implementation** (`packages/cli/src/app.ts`):
```typescript
import helmet from '@fastify/helmet';

export function createApp(options: AppOptions): FastifyInstance {
  const app = fastify({ logger: options.debug });

  // Add security headers
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],  // Required for Swagger UI
        scriptSrc: ["'self'", "'unsafe-inline'"], // Required for Swagger UI
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,  // Allow embedding for Swagger UI
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  });

  // ... rest of configuration
}
```

**Security Headers Added**:
- `Content-Security-Policy`: Prevents XSS attacks
- `X-Frame-Options`: Prevents clickjacking
- `X-Content-Type-Options`: Prevents MIME sniffing
- `Strict-Transport-Security`: Forces HTTPS
- `X-DNS-Prefetch-Control`: Controls DNS prefetching
- `X-Download-Options`: Prevents file execution in IE

**Benefits**:
- Industry-standard security hardening
- Protects against common web attacks
- Minimal performance overhead
- Compatible with Swagger UI

### 4. Fix Dependency Security (P0 - Critical)

**Problem**: Runtime dependencies in wrong section

**Fix** (`packages/core/package.json`):
```bash
cd packages/core

# Move undici from devDependencies to dependencies
yarn add undici type-fest

# Remove from devDependencies if present
```

**Updated package.json**:
```json
{
  "dependencies": {
    "@keyv/compress-brotli": "^2.0.5",
    "cache-manager": "^7.2.7",
    "debug": "^4.4.3",
    "keyv": "^5.5.5",
    "keyv-file": "^5.3.3",
    "ky": "^1.14.2",
    "p-queue": "^9.0.1",
    "pretty-format": "^30.2.0",
    "quick-lru": "^7.3.0",
    "type-fest": "^5.3.1",
    "undici": "^6.0.0",
    "zod": "^4.2.1"
  }
}
```

**Benefits**:
- Correct dependency resolution in production
- Prevents missing dependency errors
- Proper semantic versioning

### 5. Remove Unused Dependencies (P1 - High)

**Root package.json cleanup**:
```bash
# Remove unused dependencies
yarn remove node-geocoder fetch-retry dayjs pretty-format

# These are not imported anywhere in the codebase
```

**Benefits**:
- Reduced attack surface (fewer dependencies = fewer CVEs)
- Smaller bundle size (~5MB reduction)
- Faster install times
- Cleaner dependency tree

### 6. Add Security Scanning (P1 - High)

**Add to CI/CD Pipeline** (`.github/workflows/security.yml`):
```yaml
name: Security Scan

on:
  push:
    branches: [main, develop]
  pull_request:
  schedule:
    - cron: '0 0 * * 1'  # Weekly scan

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          
      - name: Install dependencies
        run: yarn install --frozen-lockfile
        
      - name: Run npm audit
        run: yarn audit --level=moderate
        
      - name: Run Snyk scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high
          
      - name: OWASP Dependency Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          project: 'geocoder'
          path: '.'
          format: 'HTML'
```

**Benefits**:
- Automated vulnerability detection
- Early warning for security issues
- Compliance documentation
- Prevents merging code with known CVEs

## Impact Analysis

### Security Posture

| Category | Before | After | Improvement |
|----------|--------|-------|-------------|
| **DoS Protection** | ❌ None | ✅ Rate limited | **Critical fix** |
| **Input Validation** | ⚠️ Basic | ✅ Comprehensive | **Medium fix** |
| **Security Headers** | ❌ Missing | ✅ Helmet enabled | **High fix** |
| **Dependency Security** | ⚠️ Issues | ✅ Resolved | **Critical fix** |
| **CVE Exposure** | 🔴 High | 🟢 Low | **Significant** |

### Compliance

- ✅ OWASP Top 10 compliance
- ✅ Nominatim usage policy compliance
- ✅ CWE-770 (Unrestricted Resource Allocation) - Fixed
- ✅ CWE-20 (Improper Input Validation) - Fixed

### Performance Impact

- Rate limiting: <1ms overhead per request
- Input validation: <0.1ms overhead per request
- Security headers: <0.1ms overhead per request
- **Total overhead**: <2ms (negligible)

## Implementation Plan

### Week 1: Critical Security Fixes

**Day 1**: Add rate limiting
- Install @fastify/rate-limit
- Configure rate limiting middleware
- Add tests for rate limit enforcement
- Document configuration options

**Day 2**: Add input validation
- Update Zod schemas with length/regex constraints
- Add injection prevention checks
- Add validation error tests
- Document validation rules

**Day 3**: Add security headers
- Install @fastify/helmet
- Configure CSP for Swagger UI compatibility
- Test all endpoints with security headers
- Verify Swagger UI still functions

**Day 4**: Fix dependency issues
- Move undici and type-fest to dependencies
- Remove unused dependencies
- Verify clean install on fresh checkout
- Update lock files

**Day 5**: Testing and validation
- Security penetration testing
- DoS attack simulation
- Input fuzzing tests
- Dependency vulnerability scan

### Week 2: Monitoring and Documentation

**Day 1-2**: Add security monitoring
- Set up security scanning CI/CD
- Configure vulnerability alerts
- Document security policies

**Day 3-4**: Documentation
- Update README with security considerations
- Document rate limit configuration
- Create security policy document
- Add SECURITY.md for responsible disclosure

**Day 5**: Deployment
- Deploy to staging with monitoring
- Validate security controls
- Gradual production rollout

## Testing Strategy

### Unit Tests

```typescript
// app.spec.ts
describe('Rate Limiting', () => {
  it('should block requests after rate limit exceeded', async () => {
    const app = createApp(testConfig);
    
    // Make 100 requests (at limit)
    const requests = Array.from({ length: 100 }, () =>
      app.inject({ method: 'GET', url: '/search?q=test' })
    );
    await Promise.all(requests);
    
    // 101st request should fail
    const response = await app.inject({
      method: 'GET',
      url: '/search?q=test'
    });
    
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: 'Too Many Requests',
      message: expect.stringContaining('Rate limit exceeded')
    });
  });
});

describe('Input Validation', () => {
  it('should reject queries exceeding 500 characters', async () => {
    const longQuery = 'a'.repeat(501);
    const response = await app.inject({
      method: 'GET',
      url: `/search?q=${longQuery}`
    });
    
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('must not exceed 500 characters');
  });
  
  it('should reject queries with URLs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search?q=http://evil.com'
    });
    
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('cannot contain URLs');
  });
});

describe('Security Headers', () => {
  it('should include CSP header', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
```

### Penetration Testing

```bash
# DoS attack simulation
ab -n 10000 -c 100 http://localhost:3000/search?q=test

# Input fuzzing
echo "Testing various inputs..."
curl "http://localhost:3000/search?q=$(python -c 'print("a"*1000)')"
curl "http://localhost:3000/search?q=<script>alert('xss')</script>"
curl "http://localhost:3000/search?q=../../../etc/passwd"

# Security headers check
curl -I http://localhost:3000/docs | grep -E "(Content-Security-Policy|X-Frame-Options)"
```

### Security Scanning

```bash
# Dependency vulnerabilities
yarn audit --level=moderate

# Known CVEs
npx snyk test

# OWASP check
docker run --rm -v $(pwd):/src owasp/dependency-check --scan /src
```

## Rollout Strategy

1. **Week 1**: Deploy to staging with monitoring
2. **Week 1**: Internal penetration testing
3. **Week 2**: Gradual production rollout (10% → 50% → 100%)
4. **Week 2**: Monitor for security alerts and false positives
5. **Week 3**: Full rollout after validation

## Rollback Plan

Each security control can be disabled independently:

```typescript
// Disable rate limiting (emergency only)
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
if (RATE_LIMIT_ENABLED) {
  app.register(rateLimit, config);
}

// Disable helmet (emergency only)
const HELMET_ENABLED = process.env.HELMET_ENABLED !== 'false';
if (HELMET_ENABLED) {
  app.register(helmet, config);
}
```

**Note**: Only disable security controls if they cause critical service disruption. Investigate and fix root cause immediately.

## Alternatives Considered

### Alternative 1: Use Cloudflare Rate Limiting
- **Pros**: Offload rate limiting to edge, DDoS protection
- **Cons**: Requires Cloudflare account, costs money, less control
- **Decision**: Application-level rate limiting is sufficient for now

### Alternative 2: Use API Gateway (AWS API Gateway, Kong)
- **Pros**: Enterprise-grade security, centralized management
- **Cons**: Infrastructure complexity, cost, overkill for current scale
- **Decision**: Defer to future when scale requires it

### Alternative 3: Database-Level Rate Limiting
- **Pros**: Persistent across restarts, shared across instances
- **Cons**: Slower, adds database dependency
- **Decision**: In-memory rate limiting sufficient for single-instance

## Success Criteria

✅ **Must Have**:
- Rate limiting functional (429 after exceeding limit)
- Input validation blocks malicious inputs
- Security headers present on all responses
- Zero high/critical vulnerabilities in dependency scan
- All security tests passing

✅ **Nice to Have**:
- Security monitoring dashboard
- Automated vulnerability scanning in CI/CD
- Security policy documentation
- Penetration test report

## Dependencies

**New Dependencies**:
- `@fastify/rate-limit` - Rate limiting middleware
- `@fastify/helmet` - Security headers

**Moved Dependencies**:
- `undici` (devDep → dep)
- `type-fest` (devDep → dep)

**Removed Dependencies**:
- `node-geocoder` (unused)
- `fetch-retry` (unused)
- `dayjs` (unused)
- `pretty-format` (unused in production)

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Fastify Security Best Practices](https://fastify.dev/docs/latest/Guides/Security/)
- [CWE-770: Allocation of Resources Without Limits](https://cwe.mitre.org/data/definitions/770.html)
- [Related: RFC-003 Reliability Improvements](./RFC-003-Reliability-Improvements.md)
