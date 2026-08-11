# ADR-0010: Admit Immutable Writes with Owner-Bound Reservation Attempts

## Status

- Accepted
- Date: 2026-08-11
- Version: 1.0

## Context

ADR-0008 separated immutable packet acceptance from cooldown state, but its
initial contract replayed the same reservation identifier to every concurrent
same-idempotency invocation. Any replay could release that shared reservation
while the winning invocation was awaiting immutable storage. Storage could then
contain an accepted packet while the control record was released and the
cooldown remained uncommitted.

Post-write verification cannot repair this transaction boundary: release may
already have succeeded before the storage response is available. The fix must
make write authority an atomic control-plane transition before storage begins.

## Decision

Each new reservation has generation `1` and a random canonical 128-bit `fba1`
attempt token. The creator receives the raw token once. The control record stores
only a domain-separated SHA-256 digest, and same-idempotency observers receive a
pending result without authority.

After every fallible validation, analysis-resolution, identity projection, and
packet-construction step, the owner calls `beginImmutableWrite`. A compare-and-
swap changes the record from `reserved` to `writing` only when reservation ID,
idempotency digest, generation, and attempt-token digest all match. Conditional
immutable storage is permitted only after `write-started`.

`release` requires the same owner authority and succeeds only from `reserved`.
It never changes `writing` or `committed`. An ambiguous storage or control-store
outcome stays reconciliation-only: the deterministic reservation/packet identity
is probed by `commitAccepted`, and a same-key observer cannot reopen release or
write authority. After its lease, a writing record no longer blocks unrelated
work but remains available through the bounded reconciliation horizon.

Legacy records without attempt metadata remain readable. They cannot acquire
new write/release authority and are limited to terminal replay or bounded
acceptance reconciliation.

The raw attempt token is secret control material. It is request-local only and
is prohibited from content storage, outboxes, logs, traces, analytics, Admin,
MCP, exception text, and public projections.

## Consequences

### Positive

- Release can never overtake an admitted immutable write.
- Same-key replays cannot mutate an owner's in-flight attempt.
- Ambiguous compare-and-swap and immutable-write outcomes converge without an
  unsafe compensating release.
- Existing version-1 control records remain parseable and expire under their
  original retention boundaries.

### Negative

- Consumers must carry request-local attempt authority between `reserve`,
  `beginImmutableWrite`, and any pre-write `release`.
- The initial unreleased progressive-cooldown response contract changes:
  active same-key replay is `attempt-pending`, and release now requires owner
  fields.
- Store adapters must accept the additive attempt digest, generation,
  `writing` status, and write-start timestamp fields.

## Alternatives considered

### Confirm after storage, then commit

Rejected because another invocation can release before storage returns.

### Bind replays with a payload hash

Rejected because small-domain structured feedback values are guessable and
payload hashes would widen the privacy boundary without proving write ownership.

### Give the same attempt token to replays

Rejected because it recreates shared release/write authority.

## Rollback

Disable the consumer's inherited remote feature flag to stop new reservations.
Continue acceptance reconciliation for records already in `writing`, then allow
the documented TTL and backup-deletion policy to remove control state. Do not
re-enable the earlier shared-reservation behavior.
