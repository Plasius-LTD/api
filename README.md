# @plasius/api

[![npm version](https://img.shields.io/npm/v/@plasius/api.svg)](https://www.npmjs.com/package/@plasius/api)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Plasius-LTD/api/ci.yml?branch=main&label=build&style=flat)](https://github.com/Plasius-LTD/api/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/Plasius-LTD/api)](https://codecov.io/gh/Plasius-LTD/api)
[![License](https://img.shields.io/github/license/Plasius-LTD/api)](./LICENSE)
[![Code of Conduct](https://img.shields.io/badge/code%20of%20conduct-yes-blue.svg)](./CODE_OF_CONDUCT.md)
[![Security Policy](https://img.shields.io/badge/security%20policy-yes-orange.svg)](./SECURITY.md)
[![Changelog](https://img.shields.io/badge/changelog-md-blue.svg)](./CHANGELOG.md)

Public generic API helper package.


## What this package contains

- Public helper exports compiled to `dist/**`
- Reusable transport-security helper utilities
- Reusable session helper utilities compatible with `withSession` middleware
- Reusable generic parameter-validation middleware for request ingress checks
- Governance/legal materials (`docs/**`, `legal/**`)

## Package Boundary (Public by Design)

- `@plasius/api` is intentionally a **generic helper package**.
- Private application handlers and business-specific backend code must remain in private consumer repositories.
- Publish safeguards now block packaging of private runtime trees (`src/**`, local settings, and generated OpenAPI artifacts).
- `npm run pack:check` also fails if public code roots (`src/**`, `tests/**`, `demo/**`) contain forbidden private/product identifiers.

## Transport Security Baseline

- Exports helper functions:
  - `applyBaselineSecurityHeaders(headers)`
  - `isHttpsRequest(request)`
  - `isInsecureLocalRequest(request)`
  - `shouldEnforceHttps()`
- These helpers support strict header policy and HTTPS enforcement behavior for callers.

## Session Helper Baseline

- Exports helper functions:
  - `ensureSession(request, options?)`
  - `getSessionIdFromRequest(request, cookieName?)`
  - `createSessionCookie(sessionId, options?)`
- `withSession` middleware is implemented using these helpers and keeps secure defaults (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).

## Request Validation Baseline

- Exports helper middleware:
  - `withValidatedParam({ paramName, validate, contextKey? })`
- Consumers keep validation policy local by supplying their own validator and normalized value contract.

## Security Configuration

- `CORS_ALLOWED_ORIGINS` or `ALLOWED_ORIGINS`: comma-separated trusted browser origins for credentialed CORS. Credentialed wildcard CORS is rejected by default.
- `HMAC_SECRET`: required before request IP addresses are hashed for privacy-preserving request logs.
- `RATE_LIMIT_HMAC_SECRET`: required for rate-limit identity hashing. If omitted, `HMAC_SECRET` is used.
- `AUTH_COOKIE_SAME_SITE` or `COOKIE_SAME_SITE`: optional cookie `SameSite` override. Defaults to `Lax`; use `None` only for HTTPS deployments that genuinely require cross-site cookies.
- `PUBLIC_BASE_URL`, `FRONTEND_DOMAIN`, or `DOMAIN`: configured deployment origin used before request-derived URL data for cookie security decisions.
- `TRUST_PROXY_HEADERS`: opt-in flag for using forwarded host/proto/IP headers. Leave unset unless the deployment edge strips and rewrites those headers.
- `RATE_LIMIT_FAIL_OPEN`: optional override for production rate-limit backend outages. Production fails closed by default.

## Install

```bash
npm install @plasius/api
```

## Entrypoints

- Main module: `@plasius/api`
- Middleware module: `@plasius/api/middleware`

### Example

```ts
import {
  applyBaselineSecurityHeaders,
  isHttpsRequest,
  shouldEnforceHttps,
} from "@plasius/api";
```

```ts
import { withCors, withRateLimiting, withMiddleware } from "@plasius/api/middleware";
```

```ts
import { withValidatedParam } from "@plasius/api/middleware";

const requireUserId = withValidatedParam({
  paramName: "id",
  validate: (rawValue) =>
    typeof rawValue === "string" && rawValue.trim()
      ? { ok: true, value: rawValue.trim() }
      : { ok: false, error: "Invalid user ID" },
});
```

## Local development

```bash
npm ci
npm run build
npm test
npm run pack:check
```

`npm run build` compiles the public package entrypoint to `dist/`.

## Publish checklist

1. Update `CHANGELOG.md` under `Unreleased`.
2. Run `npm ci && npm run clean && npm run build && npm test && npm run pack:check`.
3. Bump `package.json` version.
4. Tag and push (`vX.Y.Z`).
5. Publish through the CD workflow (recommended) or `npm publish`.

## Governance

- Security policy: [`SECURITY.md`](./SECURITY.md)
- Code of conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- ADRs: [`docs/adrs`](./docs/adrs)
- CLA and legal docs: [`legal`](./legal)

## License

Apache-2.0
