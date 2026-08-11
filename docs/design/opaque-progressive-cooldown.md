# Opaque Progressive Cooldown and Reservation Control

## Purpose

Provide a reusable, storage-agnostic control for low-volume submission surfaces that
must reserve work before writing an immutable packet and start a progressive
cooldown only after that packet has been accepted.

This package does not identify people. A consumer must derive a purpose- and
version-scoped, 256-bit keyed pseudonym before calling the control. Raw account
identifiers, IP addresses, device fingerprints, bearer tokens, and free-form
values are outside the contract.

## Rollout boundary

This work belongs to the feedback-intake Feature and inherits its remotely
controlled `feedback.bug-report.enabled` flag. The package does not evaluate a
product flag itself: consumers must evaluate their rollout flag before invoking
the control. Disabling the flag stops new reservations; existing immutable
acceptances may still be reconciled so control state converges safely.

## Public contract

`OpaqueProgressiveCooldownController` accepts:

- an opaque subject consisting of exactly 256 bits encoded as unpadded base64url;
- a closed purpose and version scope;
- a random idempotency token;
- a compare-and-swap store;
- an immutable-acceptance verifier;
- optional deterministic clock and reservation-ID factory dependencies.

The persisted state key has the exact
`fbs1.<43 canonical unpadded base64url characters>` form. Reservation IDs have
the exact `fbr1.<22 canonical unpadded base64url characters>` form and represent
128 random bits. Both forms reject alternate encodings with non-zero unused pad
bits.

The controller exposes:

1. `getEligibility` for an exact availability decision;
2. `reserve` for one atomic active reservation per scope;
3. `commitAccepted` after the verifier confirms immutable acceptance;
4. `release` when no immutable packet was accepted.

`commitAccepted` and `release` are replay safe. Reconciliation workers use the
same `commitAccepted` operation with the reservation details held in their
identifier-isolated outbox. A released reservation may later be promoted to
committed when immutable acceptance is discovered, preventing a cross-store race
from losing cooldown state.

## State machine

```text
available -> reserved -> committed -> cooldown -> available
                 |
                 +-> released -> available
                 |
                 +-> lease expired -> pending reconciliation
```

- Only compare-and-swap can create or change a reservation.
- A second idempotency token cannot reserve while another lease is active.
- The same token replays the original result.
- An expired reservation no longer blocks new work but remains available for a
  bounded reconciliation period.
- Commit is impossible unless the injected verifier confirms an immutable
  acceptance.
- Every accepted transition uses a clock value observed after verification and
  the latest state read. Its commit time and cooldown may never move backwards,
  including when delayed reconciliation races a newer commit.
- Store, verifier, corrupt-state, and repeated compare-and-swap failures deny the
  operation with a bounded retry response.

## Default timing policy

- Reservation lease: 5 minutes.
- Accepted cooldown ladder: 5 minutes, 15 minutes, 1 hour, 6 hours, 24 hours.
- Cooldown cap: 24 hours.
- Quiet reset: 48 hours after the last accepted commit.
- Dependency-unavailable retry: 30 seconds.
- Total store/verifier operation deadline: 2 seconds.
- Reconciliation retention: 6 days after the reservation lease, release, or
  quiet-reset expiry.
- Live deletion starts when reconciliation retention expires.
- The following fixed 24-hour safety window is reserved for asynchronous
  deletion verification and bounded backup expiry. Live data, soft-deleted
  copies, and backups must be absent no more than 7 days after the relevant
  control expiry.

Durations are configurable, but cooldown values must be non-decreasing and may
never exceed 24 hours. `Retry-After` is the ceiling of the exact remaining
milliseconds so a caller never retries before the stated availability instant.
If the clock is invalid or cannot represent every required deadline without
integer overflow, the operation fails before storage. The relative retry remains
available, while the untrustworthy absolute retry timestamp is omitted.

## Privacy boundary

The controller hashes the already-opaque subject together with purpose and
version before passing a state key to the store. It separately hashes the random
idempotency token. Persisted state therefore contains:

- one purpose/version-isolated canonical `fbs1` state-key digest;
- streak and expiry counters;
- random reservation IDs;
- idempotency digests;
- reservation status and server timestamps.

It contains no source subject, purpose string, account identifier, IP address,
fingerprint, request metadata, or content. The state key and its records remain
pseudonymous personal data and must be isolated, access restricted, excluded from
logs and analytics, and deleted according to the emitted `hardDeleteByMs`.

The package has no logger and all public errors use closed codes without
reflecting input or storage exceptions.

## Store requirements

Store implementations must:

- make `compareAndSwap` atomic for one `stateKey`;
- treat `expectedRevision: null` as create-if-absent;
- return `applied: false` for a revision conflict;
- return a fresh opaque revision for a successful write;
- begin live deletion no later than the state's `hardDeleteByMs` minus
  `PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS`;
- ensure live data, soft-deleted copies, and backups are absent by
  `hardDeleteByMs`;
- honour the supplied abort signal and total operation deadline;
- never log keys, state, revisions, or thrown dependency payloads;
- use bounded request deadlines and fail by throwing on uncertainty.

The controller retries only revision conflicts, with a configurable small bound.
It does not retry dependency failures.

Snapshots are accepted only when every field is known and every temporal value
matches the policy exactly:

- reservation leases equal `reservedAt + reservationLease`;
- reserved retention equals `lease expiry + retention`;
- released retention equals `releasedAt + retention`;
- committed cooldowns equal their exact ladder rung;
- committed retention equals `committedAt + quiet reset + retention`;
- zero-streak state may retain committed reconciliation history only at or after
  the exact quiet-reset boundary;
- `hardDeleteByMs` equals the latest reconciliation horizon plus the fixed
  24-hour deletion/backup safety window;
- event timestamps are not in the future and the latest committed timestamp
  does not precede another retained commit; and
- retained commits follow the configured ladder exactly, including its quiet
  reset and cap.

Shorter and longer values are both corruption. Timestamp overflow,
non-canonical digests, unknown fields, future events, stale top-level state, and
a successful update that reuses its expected revision all fail closed.

## Validation strategy

Tests cover:

- the exact default ladder, cap, and 48-hour reset;
- exact and rounded-up retry timing;
- concurrent reservations and commits;
- idempotent reserve, commit, and release;
- release/acceptance reconciliation;
- expired reservation reconciliation;
- held-verifier reconciliation racing a newer capped commit;
- exact lease, release, commit, cooldown, reconciliation, hard-delete,
  overflow, and clock-regression boundaries;
- forged retained commit histories that skip, regress, or reset ladder rungs;
- unavailable stores/verifiers and exhausted revision conflicts;
- malformed persisted state and unsafe ingress values;
- absence of raw opaque subjects, purpose strings, and idempotency tokens from
  persisted state;
- deterministic clocks and generated reservation IDs;
- package exports and changed-source LCOV coverage.
