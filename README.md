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

## Install

```bash
npm install @plasius/api
```

## Entrypoints

- Main module: `@plasius/api`

### Example

```ts
import {
  applyBaselineSecurityHeaders,
  isHttpsRequest,
  shouldEnforceHttps,
} from "@plasius/api";
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
