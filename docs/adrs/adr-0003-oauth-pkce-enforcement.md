# ADR-0003: Enforce PKCE (S256) for OAuth Authorization Code Flows

## Status

- Proposed -> Accepted
- Date: 2026-02-27
- Version: 1.0

## Context

OAuth start routes and callbacks previously relied on `state` CSRF protection without enforcing PKCE. That leaves browser-based authorization code flows below current OAuth security guidance and increases risk if authorization codes are intercepted.

## Decision

Enforce RFC 7636 PKCE using `S256` across all OAuth providers (`google`, `apple`, `microsoft`) in `@plasius/api`:

- generate high-entropy `code_verifier` server-side per login attempt
- derive `code_challenge` using SHA-256 base64url encoding (`S256`)
- attach `code_challenge` and `code_challenge_method=S256` to provider authorize redirects
- persist `code_verifier` in short-lived HttpOnly cookie tied to callback state
- include `code_verifier` in token exchange on callback
- keep legacy callback compatibility for in-flight pre-PKCE state payloads during rollout

## Alternatives Considered

- Continue with state-only CSRF protection (rejected: weaker than current BCP guidance).
- Generate PKCE only in frontend code (rejected: creates storage/exposure risks in browser JS and does not cover non-frontend auth callers consistently).

## Consequences

- Positive: improved protection against authorization code interception and better alignment with RFC 7636 + OAuth 2.0 Security BCP.
- Negative: additional cookie/state handling complexity and stricter callback requirements.
- Follow-up: remove legacy non-PKCE callback compatibility once rollout telemetry confirms no pre-PKCE state payloads.
