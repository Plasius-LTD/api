# ADR-0005: Public Package Boundary and Publish Gates

## Status

- Proposed -> Accepted
- Date: 2026-02-28
- Version: 1.0

## Context

`@plasius/api` currently contains source trees copied from private backend runtime code. Releasing those internals as a public npm package would expose implementation details and business-specific handlers that should remain private.

## Decision

Position `@plasius/api` as a generic helper package only, and enforce this boundary at publish time:

- publish only curated public artifacts (`dist/**` + governance docs)
- remove publish-time inclusion of `src/**`, local settings files, and generated OpenAPI trees
- add an automated `pack:check` gate that fails if forbidden paths are included in the npm tarball
- fail `pack:check` when public code roots include forbidden private/product identifiers (e.g., private monorepo names or proprietary artifact names)

## Alternatives Considered

- Keep publishing all source and rely on manual review (rejected: too error-prone).
- Mark package private until cleanup is complete (rejected: conflicts with public package strategy).

## Consequences

- Positive: reduced risk of accidental private-code exposure and clearer package intent.
- Negative: consumers can no longer rely on deep-importing internal source files; helper APIs must be explicitly exported and versioned.
