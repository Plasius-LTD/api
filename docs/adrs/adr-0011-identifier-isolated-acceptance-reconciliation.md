# ADR-0011: Reconcile Immutable Acceptance with Isolated Control Identifiers

## Status

- Accepted
- Date: 2026-08-13
- Version: 1.0

## Context

ADR-0010 makes ambiguous immutable writes reconciliation-only. A durable worker
must later determine whether the packet exists and converge the separate
cooldown aggregate. Reusing `commitAccepted` would require an outbox to retain
scope and raw idempotency input. Those values are unnecessary pseudonymous
linkage and violate the identifier-isolated outbox boundary used by feedback
intake.

## Decision

Expose `reconcileImmutableAcceptance` on
`OpaqueProgressiveCooldownController`. Its closed command contains only:

- a canonical `fbs1` control-state key;
- a canonical `fbr1` reservation ID; and
- an optional genuine `AbortSignal`.

It rejects additional, accessor-backed, identity-bearing, or malformed input
before I/O. The controller reads only the named aggregate. A committed record is
an exact replay and does not probe storage. Before the fixed reconciliation
boundary, the injected immutable-acceptance verifier receives only the same two
identifiers plus the controller-owned signal and deadline. Verified acceptance
uses the same compare-and-swap cooldown transition as the request path. Missing
acceptance remains pending without mutation.

At or after the boundary, a record is pruned and returns `expired`, including
when a bounded verifier call crosses that boundary. This preserves the exact
configured reconciliation lifetime and makes the boundary race deterministic.
Revision conflicts, dependency failure, corrupt state, deadline expiry, and
clock failure remain bounded and fail closed.

The command and result never contain an opaque subject, account identifier,
scope, idempotency key or digest, packet ID or Blob locator, narrative, write
token, attempt digest, IP address, user agent, or telemetry field. The package
does not log either dependency.

## Consequences

- An outbox containing only state ID and reservation ID is sufficient for
  deterministic convergence.
- Request-time authority and worker-time authority remain separate.
- Cooldown timing and streak updates continue to have one implementation.
- Workers can delete an outbox entry only after `committed`, `expired`, or a
  closed missing result; `pending-reconciliation` and `unavailable` must retry.
- Control state remains pseudonymous personal data and retains the existing
  deletion and backup obligations.

## Alternatives rejected

### Persist the idempotency key or opaque subject

Rejected because it expands correlation and breach impact without improving
the immutable-acceptance proof.

### Reimplement cooldown commits in the consuming site

Rejected because it duplicates ladder, reset, retention, and concurrency rules
outside the package that owns them.

### Treat an ambiguous write as released

Rejected because a durable packet could exist while the control plane permits
immediate further submissions.
