# ADR-0013: Support host-owned shared request counters

## Status

- Accepted
- Date: 2026-11-11

## Context

The Redis implementation is useful where Redis is already operated. Some hosts
have a different approved shared store and still need coordinated request
limits and clear outage handling across replicas.

## Decision

Keep Redis as the default and add an explicit store to the existing middleware.
The package owns fixed window boundaries, purpose-separated opaque bucket
derivation, a deadline, and closed HTTP decisions. The store owns conditional
consumption across replicas, expiry, and cancellation. The host supplies a
fixed namespace and route key and establishes a trusted principal before a
per-user check. The provider sees no URL, raw identity or request header.

The explicit store is authoritative. Exhaustion returns 429; deadline,
invalid results and provider outage return 503 with a generic message. Later
checks stop when an earlier check rejects. Permits may be charged without
admission when a later check fails or a write result is ambiguous. Never
refund or retry those writes in middleware. A late store result cannot
overwrite the completed response.

## Alternatives

- A process-local counter loses the shared limit at scale and after restart.
- A second provider SDK in the package couples all consumers to a service
  they may not run.
- Reusing the progressive cooldown changes fixed-window semantics and mixes
  submission reservations with HTTP admission.

## Consequences

Existing consumers and Redis defaults remain unchanged. New consumers need
matching policy, clocks and secrets across replicas and must verify their
adapter's atomicity, expiry and bounded provider load. The package tests the
portable contract, including rollover, timeouts, failures, and redaction. This
additive public API ships through the existing protected npm release workflow.

## Bounded duration extension

[Task #82](https://github.com/Plasius-LTD/api/issues/82) extends the accepted
shared-counter window from one day to 31 days, inclusive. It preserves the
existing epoch alignment and provider contract without extra operations. The
host owns retention through the supplied absolute end and must account for two
fixed-window allowances inside an arbitrary interval of the same duration.
Invalid, fractional or longer windows still fail at construction before I/O.
See the [window design](../design/shared-rate-limit-windows.md) for acceptance
tests, inherited feedback flags and package-first delivery constraints.
