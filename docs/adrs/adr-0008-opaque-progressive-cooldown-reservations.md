# ADR-0008: Use Opaque Compare-and-Swap Reservations for Progressive Cooldowns

## Status

- Accepted
- Date: 2026-07-18
- Version: 1.0

## Context

Submission systems that write immutable packets and maintain a separate
anti-abuse control plane cannot update both stores in one transaction. Starting
a cooldown before packet acceptance penalises failed submissions. Starting it
without idempotency or reconciliation allows concurrent requests and partial
failures to bypass the control.

The reusable API package must not accept raw identity or request telemetry, and it
must remain independent of a particular database.

## Decision

Provide a purpose/version-scoped opaque reservation controller with:

- strict 256-bit opaque-subject ingress;
- one-way derived canonical `fbs1` state keys and canonical idempotency digests;
- canonical random 128-bit `fbr1` reservation identifiers;
- compare-and-swap persistence for atomic transitions;
- one active reservation lease per scope;
- immutable-acceptance verification before commit;
- replay-safe commit and release operations;
- promotion of a released reservation when later reconciliation proves
  acceptance;
- a non-decreasing configurable ladder capped at 24 hours, defaulting to
  5m, 15m, 1h, 6h, and 24h;
- an immutable, versioned policy snapshot and deterministic public fingerprint
  so consumers can pin compatible controller policy and derive coupled durable
  record horizons without duplicating constants;
- reset after 48 quiet hours;
- bounded dependency deadlines, caller cancellation, records, conflict retries,
  reconciliation, and retention;
- a six-day default reconciliation horizon followed by a fixed 24-hour
  deletion/backup safety window, with live deletion starting at the boundary
  and total removal required within seven days;
- exact, non-extendable temporal/retention invariants, monotonic commit times,
  and validated retained ladder history;
- closed fail-safe results with no input or dependency-error reflection.

The consumer supplies its remote Feature flag, keyed-pseudonym derivation,
compare-and-swap store, immutable-acceptance verifier, and operational deadlines.
The persisted state is pseudonymous personal data even though it contains only
derived keys and random control identifiers.

## Alternatives considered

### Commit cooldown before immutable storage

Rejected because transient storage failures would suppress users who did not
successfully submit.

### Keep counters in process memory

Rejected because horizontally scaled and restarted services would have divergent
state.

### Retry arbitrary store failures

Rejected because ambiguous writes and nested retries can amplify outages. Only
explicit revision conflicts are retried, with a small fixed bound.

### Accept account IDs and hash them in this package

Rejected because it would widen the package's personal-data boundary and make
accidental logging or cross-purpose correlation possible.

### Couple the package directly to one database

Rejected because the state machine is reusable and atomic compare-and-swap is the
only storage primitive it requires.

## Consequences

### Positive

- Cooldowns begin only after immutable acceptance is verifiably present.
- Concurrent callers converge on one atomic state.
- Replays and cross-store reconciliation are deterministic.
- Delayed reconciliation cannot backdate or shorten a newer cooldown.
- Corrupt or overflowing clocks, lifetimes, purge deadlines, identifiers, and
  non-fresh store revisions fail closed.
- Consumer stores can use Cosmos DB ETags, SQL row versions, Redis scripts, or
  equivalent atomic primitives.
- Raw identity and request telemetry never enter the package.
- Consumers can reject incompatible policy/controller composition before
  durable I/O while the generic controller retains supported custom policies.

### Negative

- Consumers must implement a correct compare-and-swap adapter and acceptance
  verifier.
- Control state is still pseudonymous personal data and requires a dedicated
  privacy and retention boundary.
- Store adapters must coordinate live TTL, soft deletion, and backup expiry
  against both the reconciliation boundary and hard-delete deadline.
- A delayed reconciliation commit conservatively starts its cooldown when the
  acceptance is confirmed, which can extend suppression by the reconciliation
  delay.
- The policy fingerprint is not an authentication signature; consumers must
  obtain the attestation from their configured controller dependency and pin an
  explicitly supported fingerprint at their own trust boundary.

## Rollback

Disable the consumer's remote Feature flag to stop new reservations. Continue
bounded reconciliation for already accepted immutable packets, then allow the
store TTL to delete remaining state. No state migration or data export is
required.
