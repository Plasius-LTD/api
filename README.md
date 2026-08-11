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
- Reusable opaque progressive-cooldown and immutable-acceptance reservation controls
- Governance/legal materials (`docs/**`, `legal/**`)

## Package Boundary (Public by Design)

- `@plasius/api` is intentionally a **generic helper package**.
- Private application handlers and business-specific backend code must remain in private consumer repositories.
- Publish safeguards now block packaging of private runtime trees (`src/**`, local settings, and generated OpenAPI artifacts).
- `npm run pack:check` also fails if public code roots (`src/**`, `tests/**`, `demo/**`) contain forbidden private/product identifiers.

## Transport Security Baseline

- Exports helper functions:
  - `applyBaselineSecurityHeaders(headers, options?)`
  - `isHttpsRequest(request)`
  - `isInsecureLocalRequest(request)`
  - `shouldEnforceHttps()`
- These helpers support strict header policy and HTTPS enforcement behavior for callers.
- `Cross-Origin-Opener-Policy` defaults to `same-origin`. OAuth routes that
  navigate a cross-origin identity-provider popup may opt into the bounded
  `same-origin-allow-popups` value without changing the remaining baseline:

```ts
applyBaselineSecurityHeaders(headers, {
  crossOriginOpenerPolicy: "same-origin-allow-popups",
});
```

- `withSecurity(options?)` accepts the same bounded option. Unsupported runtime
  values fail closed to `same-origin`.

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

## Opaque progressive cooldowns

`OpaqueProgressiveCooldownController` coordinates an immutable submission store
with a separately authorised anti-abuse control store. It provides atomic
reservation, acceptance-gated commit, release, idempotent replay, bounded
reconciliation, exact `Retry-After`, and a default 5m → 15m → 1h → 6h → 24h
cooldown ladder that resets after 48 quiet hours.

The controller accepts only an already purpose/version-scoped 256-bit keyed
pseudonym encoded as unpadded base64url. Never pass an account ID, email address,
IP address, bearer token, cookie, user agent, or device fingerprint. The package
derives a second purpose-isolated state digest before calling the store. Store
keys use the canonical `fbs1.<43-character base64url>` wire form and reservation
IDs use canonical 128-bit `fbr1.<22-character base64url>` values so adapters can
persist the shared entity-manager aggregate without translation. The package
never logs control input or dependency errors.

Every controller also exposes an immutable `policyAttestation`. Its
`pcp1.<sha256>` fingerprint deterministically covers the exact resolved timing,
capacity, retry, and reconciliation policy. A consumer whose own durable record
shape depends on those values must validate and pin the expected fingerprint,
then derive its horizons from `policyAttestation.policy`; it must not duplicate
policy constants. The fingerprint is a public compatibility identifier, not a
signature or secret. Trust still comes from receiving the attestation directly
from the configured controller dependency.

```ts
import {
  DEFAULT_PROGRESSIVE_COOLDOWN_POLICY_ATTESTATION,
  OpaqueProgressiveCooldownController,
  isProgressiveCooldownPolicyAttestation,
  type ImmutableAcceptanceVerifier,
  type ProgressiveCooldownStore,
} from "@plasius/api/progressive-cooldown";

declare const store: ProgressiveCooldownStore;
declare const acceptanceVerifier: ImmutableAcceptanceVerifier;

const cooldowns = new OpaqueProgressiveCooldownController({
  store,
  acceptanceVerifier,
});

if (
  !isProgressiveCooldownPolicyAttestation(cooldowns.policyAttestation) ||
  cooldowns.policyAttestation.fingerprint !==
    DEFAULT_PROGRESSIVE_COOLDOWN_POLICY_ATTESTATION.fingerprint
) {
  throw new Error("Unsupported progressive-cooldown policy.");
}

const reservation = await cooldowns.reserve({
  scope: {
    purpose: "submission.bug",
    version: "v1",
    opaqueSubjectKey: purposeScopedKeyedPseudonym,
  },
  idempotencyKey,
});
```

Consumers must:

- evaluate their remotely controlled Feature flag before creating reservations;
- derive opaque subjects with a secret-keyed, purpose/version-scoped function
  outside this package;
- implement atomic compare-and-swap with bounded deadlines;
- return a new revision for every successful update;
- honour the controller-provided abort signal and total operation deadline in
  every store and verifier call;
- verify immutable acceptance from an identifier-isolated control/outbox
  projection before commit;
- treat state keys and reservation records as pseudonymous personal data;
- begin live deletion no later than
  `hardDeleteByMs - PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS`;
- ensure live data, soft-deleted copies, and backups are absent by
  `hardDeleteByMs`;
- exclude state, revisions, keys, and dependency exceptions from logs,
  analytics, Admin, MCP, and content storage.

Store/verifier outages and corrupt state fail closed with a bounded, non-reflective
`unavailable` result. Only explicit revision conflicts are retried. See the
[design](./docs/design/opaque-progressive-cooldown.md) and
[ADR-0008](./docs/adrs/adr-0008-opaque-progressive-cooldown-reservations.md).
Persisted leases, cooldowns, six-day default reconciliation retention, and the
following fixed 24-hour deletion/backup safety window are exact: shorter,
longer, overflowing, non-canonical, future-event, or temporally regressive
values are rejected. When the injected clock itself is invalid,
`retryAfterSeconds` remains available but `retryAtMs` is intentionally omitted
because no truthful absolute timestamp can be produced.

## API Error Localization

- Exports package-owned `en-GB` error translations through `apiEnGbTranslations`.
- Standard HTTP error helpers now return default English text from `@plasius/translations` and include a stable `errorKey`.
- Text-body middleware responses keep their existing default English body and expose the key through the `x-plasius-error-key` response header.

```ts
import { apiErrorTranslationKeys, createApiErrorResponse } from "@plasius/api";

const response = createApiErrorResponse(404, apiErrorTranslationKeys.notFound);
```

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
- Progressive cooldown module: `@plasius/api/progressive-cooldown`

### Example

```ts
import {
  applyBaselineSecurityHeaders,
  isHttpsRequest,
  shouldEnforceHttps,
} from "@plasius/api";
```

```ts
import {
  withCors,
  withRateLimiting,
  withMiddleware,
} from "@plasius/api/middleware";
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
3. Open and merge the reviewed change through the protected branch workflow.
4. Bind the npm trusted publisher for `@plasius/api` to repository
   `Plasius-LTD/api`, workflow `cd.yml`, environment `production`, and the
   `npm publish` action.
5. Dispatch `cd.yml` from protected `main` with `phase: prepare`. It owns
   versioning, the release pull request, exact-SHA CI admission, tagging, and
   tokenless publication through the `production` environment.
6. Verify the protected environment, tag, provenance, npm result, and post-release
   CI.

Publication uses Node 24.18.0 LTS. Do not publish from a local machine or
configure a long-lived npm token.

## Public Artifact Integrity

CI rejects the administrative contributor-registry path from both the exact Git
index and the npm dry-run inventory without reading its contents.
Same-repository pull requests run on GitHub-hosted runners; protected `main` CI
uses the workflow-restricted self-hosted runner group, and fork code is never
scheduled there. Release metadata lands through a unique pull request, then a
second `cd.yml` run is dispatched from the exact successful `main` CI SHA. A
read-only job validates and seals the package and SBOM before the
GitHub-hosted `production` job verifies that immutable hand-off and publishes
through npm OIDC with provenance. The privileged job runs no dependency or
package lifecycle code, and no long-lived npm write token or fallback is
configured. Rollback disables `cd.yml`.

## Governance

- Contributing guidance: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Security policy: [`SECURITY.md`](./SECURITY.md)
- Code of conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- Public CI runner operations:
  [`docs/public-ci-runner-access.md`](./docs/public-ci-runner-access.md)
- ADRs: [`docs/adrs`](./docs/adrs)
- CLA and legal docs: [`legal`](./legal)

## License

Apache-2.0
