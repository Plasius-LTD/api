# ADR-0007: Bound OAuth Popup Opener Policy Overrides

## Status

- Accepted
- Date: 2026-07-28
- Version: 1.0

## Context

The API transport-security baseline emits
`Cross-Origin-Opener-Policy: same-origin`. This is the correct default for
ordinary application and API responses, but it severs cross-origin opener
relationships used by some OAuth popup flows. A constrained browser can then
stall after navigating from the relying party to an external identity
provider.

OAuth consumers need a route-specific policy without accepting arbitrary
header values or weakening CSP, HTTPS enforcement, framing protection, or the
remaining baseline.

## Decision

Allow `applyBaselineSecurityHeaders` and `withSecurity` callers to select one
of two typed opener policies:

- `same-origin`, which remains the default and fail-closed fallback;
- `same-origin-allow-popups`, for routes that participate in a cross-origin
  OAuth popup handshake.

Unsupported runtime values resolve to `same-origin`. Consumers must apply the
popup-compatible value only to the minimum OAuth route chain that needs it.

## Alternatives Considered

- Change the global default to `same-origin-allow-popups` (rejected: it weakens
  opener isolation for unrelated routes).
- Remove the opener policy from OAuth routes (rejected: an explicit bounded
  policy is easier to audit and preserves same-origin isolation semantics).
- Let consumers provide any header string (rejected: configuration mistakes
  could disable opener isolation).

## Consequences

- OAuth popup routes can retain their opener relationship across provider
  navigation where required by the browser flow.
- All existing callers retain `same-origin` without code changes.
- JavaScript callers that bypass TypeScript still fail closed for unsupported
  values.
- Route owners remain responsible for limiting the override to OAuth popup
  handshakes.

## References

- Google Identity: Get your Google API client ID
  - https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- MDN: Cross-Origin-Opener-Policy
  - https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
