# ADR-0012: Anchor Immutable Acceptance to Server Reservation Time

## Status

- Accepted
- Date: 2026-08-26
- Version: 1.0

## Context

Immutable feedback packets and pseudonymous abuse controls are stored in
separate security boundaries. Verification or reconciliation may occur after
the packet write. If cooldown expiry is based on that later control transition,
storage latency and recovery delays silently lengthen user suppression. A
consumer also needs to address a same-partition eligibility overlay without
reimplementing the package-owned state-key derivation.

## Decision

The reservation's server-owned `reservedAtMs` is the exact acceptance-time
anchor carried by the immutable packet. `ImmutableAcceptanceVerifier` receives
that value and must compare it with the schema-validated packet before returning
true. A committed result exposes it as `acceptedAtMs` and separately exposes the
later `committedAtMs` control transition.

An individual cooldown expires at `acceptedAtMs + cooldownDurationMs`. No
cooldown state is created unless immutable acceptance is verified. When delayed
or concurrent transitions complete out of order, the aggregate keeps the
maximum cooldown expiry so an earlier reservation cannot shorten a newer
cooldown. Commit time remains the ordering and 48-hour quiet-reset clock.

Export `deriveOpaqueProgressiveCooldownStateKey(scope)` as the only public
state-key projection. It applies the same closed scope validator and exact
domain-separated derivation used internally. It accepts only the existing
256-bit opaque subject contract and does not expose a reverse mapping.

Publish the runtime marker
`PROGRESSIVE_COOLDOWN_ACCEPTANCE_ANCHOR_VERSION = "reservation-v1"` so consumers
whose immutable schema depends on this invariant can fail closed against older
package versions.

## Alternatives Considered

### Anchor cooldown to control commit time

Rejected because provider latency and delayed reconciliation would extend
suppression beyond the declared ladder.

### Accept a packet or client timestamp in the commit command

Rejected because it introduces caller-controlled timing and a second source of
truth. The controller already persisted the server timestamp before the write.

### Duplicate state-key derivation in the consumer

Rejected because implementation drift could address a different partition or
weaken input validation at the privacy boundary.

## Consequences

- Cooldowns are created only after verified immutable acceptance but are never
  lengthened by later evidence processing.
- The packet and verifier share one exact, server-owned temporal value.
- Per-record cooldown expiry can precede its later reconciliation commit; the
  aggregate's maximum expiry and commit ordering remain independently checked.
- The projected state key is pseudonymous personal data. Consumers must keep it
  inside the isolated control plane and exclude it from content packets, logs,
  analytics, reports, Admin, MCP, and public responses.
