# ADR-0001: API Package Scope and Distribution

## Status

- Proposed -> Accepted
- Date: 2026-02-10
- Version: 1.0

## Context

`@plasius/api` previously lived only inside a private backend monorepo workspace. This made external reuse and independent release management difficult.

## Decision

Create a standalone root package for `@plasius/api` with:

- independent versioning and npm publishing
- standalone TypeScript build configuration
- retained Azure Functions runtime structure
- explicit governance and legal documentation

## Alternatives Considered

- Keep backend only in monorepo workspace.
- Publish directly from monorepo without standalone package.

## Consequences

- Positive: independent release cadence, cleaner dependency boundaries, reusable package.
- Negative: duplicated maintenance between monorepo backend and standalone package during transition.
- Follow-up: complete migration of consumers to published package artifacts.
