# ADR-0002: Public Repository Governance Baseline

## Status

- Proposed -> Accepted
- Date: 2026-02-10
- Version: 1.0

## Context

Public npm packages require clear contribution, security, and licensing policy to reduce legal and operational risk.

## Decision

Include governance and legal baseline files in the `@plasius/api` repository:

- `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTORS.md`
- `legal/` CLA documents and registry template
- `docs/adrs/` architecture decisions
- CI/CD workflows for repeatable release and audit operations

## Alternatives Considered

- Minimal package with only code and license.
- Governance docs hosted in a separate central repository.

## Consequences

- Positive: public-package readiness and contributor clarity from day one.
- Negative: extra documentation overhead that must be kept up to date.
