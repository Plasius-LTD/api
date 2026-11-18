# Bounded monthly shared request quotas

The feedback review host needs a low monthly admission allowance to meet its
existing GBP 2 incremental budget. The portable shared-counter middleware owns
window derivation, so the host must not bypass its current one-day validation.

Extend the opt-in shared-counter policy to accept integer windows from one
millisecond through 31 days (2,678,400,000 milliseconds), inclusive. Keep the
same epoch-aligned fixed windows, opaque HMAC buckets, absolute end timestamp,
single middleware deadline, and closed 429/503 decisions. Redis defaults and
existing shorter windows keep their behavior. No new provider operations or
dependency are needed.

This is a duration window, not a calendar month or rolling quota. An arbitrary
31-day interval can contain two fixed-window allowances. A host must include
that boundary burst in its budget and ensure its counter adapter can retain the
opaque counter until the supplied absolute end. Longer retention is opt-in;
the package neither persists personal data nor extends any host record itself.

Tests must demonstrate the exact maximum and rejection above it before I/O,
shared global buckets across operations/replicas, independent daily scopes,
unchanged Retry-After/reset and rollover semantics, no raw request/identity in
provider input, and rejection of late completion at a long-window boundary.
Existing deadline, cancellation, invalid result and Redis tests remain gates.

Delivery belongs to site Feature #1662 / Story #2193 and inherits the remotely
controlled `feedback.review-workflow.enabled` and `feedback.processing.enabled`
flags. The library adds an optional configuration range; the host rollout stays
disabled until its independent cost, load and security qualification passes.
Publish only through the existing main/production CD workflow. The site must
consume a released package version before enabling the longer policy.
