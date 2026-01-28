# Security

This document explains the security posture for GitTrends Geocoder and how we handle security-related concerns.

## Responsible disclosure

If you discover a vulnerability, please report it privately to security@example.com. Include the following:

- Affected component and version
- Steps to reproduce
- Proof-of-concept and any suggested mitigations

We aim to acknowledge reports within 48 hours and provide remediation timelines for critical issues.

## CI security checks

The repository includes an automated CI workflow (see .github/workflows/security.yml) that runs dependency scans and audits. High/critical vulnerabilities require triage before merging.

## Runtime protections

- Input validation: All external inputs are validated with Zod at API boundaries.
- Rate limiting: Application-level rate limiting is enforced to mitigate abuse.
- Security headers: Content Security Policy (CSP), X-Frame-Options, X-Content-Type-Options and HSTS are added to responses.
- Monitoring: Prometheus-compatible metrics for rate-limit hits, rate-limit blocks, and validation failures are exposed at /metrics.

## Contact

security@example.com
