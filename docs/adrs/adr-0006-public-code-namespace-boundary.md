# ADR-0006: Public Code Namespace Boundary

## Status

- Proposed -> Accepted
- Date: 2026-02-28
- Version: 1.0

## Context

This package is intended to be a public, reusable helper library. Product-specific identifiers and proprietary artifact names in source code undermine the separation between public helpers and private application/runtime code.

## Decision

Enforce a strict namespace boundary for public code roots:

- keep middleware/helper logic generic and reusable
- remove product-specific identifiers and proprietary artifact references from `src/**`, `tests/**`, and `demo/**`
- fail publish checks if forbidden references are detected in those code roots

## Alternatives Considered

- Manual review only (rejected: easy to miss during fast release cycles).
- Allow product identifiers in comments/tests only (rejected: still leaks private implementation context).

## Consequences

- Positive: cleaner separation between public helper code and private product/runtime concerns.
- Negative: the forbidden-pattern list needs occasional maintenance as private artifact names evolve.
