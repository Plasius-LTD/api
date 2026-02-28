# ADR-0004: Enforce HTTPS Transport Security Baseline for API Requests

## Status

- Proposed -> Accepted
- Date: 2026-02-28
- Version: 1.0

## Context

MITM risk is primarily a transport-layer problem. While OAuth PKCE hardens authorization-code usage, API request/response traffic still requires strict TLS posture and consistent browser hardening headers across all endpoints.

## Decision

Adopt a transport-security baseline in middleware for all API handlers:

- apply strict security headers on every request path via the middleware wrapper
- enforce HTTPS by default in production (`NODE_ENV=production`) with explicit override via `ENFORCE_HTTPS`
- allow insecure localhost traffic for local development only
- return `426 HTTPS is required` for non-local insecure transport when enforcement is active

## Alternatives Considered

- Header-only approach without HTTPS enforcement (rejected: does not block downgraded/insecure transport).
- Route-by-route HTTPS checks (rejected: inconsistent and easy to miss endpoints).

## Consequences

- Positive: stronger anti-MITM baseline, consistent security posture across all routes including those not using default middleware.
- Negative: environments that terminate TLS incorrectly must set forwarding headers correctly or requests will be rejected.
