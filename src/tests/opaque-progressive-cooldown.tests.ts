import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRESSIVE_COOLDOWN_POLICY,
  DEFAULT_PROGRESSIVE_COOLDOWN_POLICY_ATTESTATION,
  MAX_PROGRESSIVE_COOLDOWN_MS,
  OpaqueProgressiveCooldownController,
  PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS,
  ProgressiveCooldownInputError,
  attestProgressiveCooldownPolicy,
  isProgressiveCooldownPolicyAttestation,
  type ImmutableAcceptanceVerifier,
  type ProgressiveCooldownReservationRecord,
  type ProgressiveCooldownSnapshot,
  type ProgressiveCooldownState,
  type ProgressiveCooldownStore,
} from "../controls/progressiveCooldown.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 6, 18, 12, 0, 0);
const SUBJECT = "A".repeat(43);

function reservationId(index: number): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(index, 12);
  return `fbr1.${bytes.toString("base64url")}`;
}

function attemptToken(index: number): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(index, 12);
  return `fba1.${bytes.toString("base64url")}`;
}

const RESERVATION_IDS = [
  reservationId(1),
  reservationId(2),
  reservationId(3),
  reservationId(4),
  reservationId(5),
  reservationId(6),
  reservationId(7),
  reservationId(8),
] as const;

const scope = {
  purpose: "submission.bug",
  version: "v1",
  opaqueSubjectKey: SUBJECT,
} as const;

function token(index: number): string {
  return `token_${String(index).padStart(16, "0")}`;
}

function cloneState(state: ProgressiveCooldownState): ProgressiveCooldownState {
  return structuredClone(state);
}

function reservedControlState(
  recordOverrides: Partial<ProgressiveCooldownReservationRecord> = {},
  stateOverrides: Partial<ProgressiveCooldownState> = {},
): ProgressiveCooldownState {
  const record: ProgressiveCooldownReservationRecord = {
    reservationId: RESERVATION_IDS[0],
    idempotencyDigest: "A".repeat(43),
    status: "reserved",
    reservedAtMs: START,
    leaseExpiresAtMs: START + 5 * MINUTE,
    reconciliationUntilMs: START + 5 * MINUTE + 6 * DAY,
    ...recordOverrides,
  };
  return {
    schemaVersion: "1",
    streak: 0,
    reservations: [record],
    hardDeleteByMs:
      record.reconciliationUntilMs + PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS,
    ...stateOverrides,
  };
}

class AtomicMemoryStore implements ProgressiveCooldownStore {
  readonly records = new Map<
    string,
    { revision: string; state: ProgressiveCooldownState }
  >();
  readonly keys: string[] = [];
  readonly writes: ProgressiveCooldownState[] = [];
  private nextRevision = 1;

  async read(stateKey: string): Promise<ProgressiveCooldownSnapshot | null> {
    this.keys.push(stateKey);
    const current = this.records.get(stateKey);
    return current
      ? {
          revision: current.revision,
          state: cloneState(current.state),
        }
      : null;
  }

  async compareAndSwap(input: {
    stateKey: string;
    expectedRevision: string | null;
    state: ProgressiveCooldownState;
  }): Promise<{ applied: boolean; revision?: string }> {
    const current = this.records.get(input.stateKey);
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== input.expectedRevision) {
      return { applied: false };
    }

    const revision = String(this.nextRevision++);
    const state = cloneState(input.state);
    this.records.set(input.stateKey, { revision, state });
    this.writes.push(cloneState(state));
    return { applied: true, revision };
  }
}

function harness(options?: {
  store?: ProgressiveCooldownStore;
  acceptanceVerifier?: ImmutableAcceptanceVerifier;
  policy?: ConstructorParameters<
    typeof OpaqueProgressiveCooldownController
  >[0]["policy"];
}) {
  let nowMs = START;
  let idIndex = 0;
  const accepted = new Set<string>();
  const store = options?.store ?? new AtomicMemoryStore();
  const acceptanceVerifier =
    options?.acceptanceVerifier ??
    ({
      hasImmutableAcceptance: async ({ reservationId }) =>
        accepted.has(reservationId),
    } satisfies ImmutableAcceptanceVerifier);

  const controller = new OpaqueProgressiveCooldownController({
    store,
    acceptanceVerifier,
    clock: { nowMs: () => nowMs },
    reservationIdFactory: () => {
      idIndex += 1;
      return reservationId(idIndex);
    },
    attemptTokenFactory: () => attemptToken(idIndex),
    policy: options?.policy,
  });

  return {
    accepted,
    controller,
    store,
    now: () => nowMs,
    setNow: (next: number) => {
      nowMs = next;
    },
    advance: (durationMs: number) => {
      nowMs += durationMs;
    },
  };
}

async function eligibilityForPersistedState(
  state: ProgressiveCooldownState,
  nowMs = START,
) {
  const controller = new OpaqueProgressiveCooldownController({
    store: {
      read: async () => ({
        revision: "revision-1",
        state: cloneState(state),
      }),
      compareAndSwap: async () => ({
        applied: false,
      }),
    },
    acceptanceVerifier: {
      hasImmutableAcceptance: async () => false,
    },
    clock: { nowMs: () => nowMs },
  });
  return controller.getEligibility({ scope });
}

async function reserveAndAccept(
  testHarness: ReturnType<typeof harness>,
  index: number,
) {
  const reserved = await testHarness.controller.reserve({
    scope,
    idempotencyKey: token(index),
  });
  expect(reserved.status).toBe("reserved");
  if (reserved.status !== "reserved") {
    throw new Error("expected reservation");
  }
  testHarness.accepted.add(reserved.reservationId);
  const committed = await testHarness.controller.commitAccepted({
    scope,
    idempotencyKey: token(index),
    reservationId: reserved.reservationId,
  });
  expect(committed.status).toBe("committed");
  if (committed.status !== "committed") {
    throw new Error("expected commit");
  }
  return { committed, reserved };
}

describe("OpaqueProgressiveCooldownController", () => {
  it("publishes the exact default ladder and hard cap", () => {
    expect(DEFAULT_PROGRESSIVE_COOLDOWN_POLICY.cooldownLadderMs).toEqual([
      5 * MINUTE,
      15 * MINUTE,
      HOUR,
      6 * HOUR,
      DAY,
    ]);
    expect(DEFAULT_PROGRESSIVE_COOLDOWN_POLICY.resetAfterMs).toBe(48 * HOUR);
    expect(
      DEFAULT_PROGRESSIVE_COOLDOWN_POLICY.reconciliationRetentionMs,
    ).toBe(6 * DAY);
    expect(MAX_PROGRESSIVE_COOLDOWN_MS).toBe(DAY);
    expect(PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS).toBe(DAY);
  });

  it("attests the exact resolved policy without exposing mutable state", () => {
    const defaultHarness = harness();
    const defaultAttestation = attestProgressiveCooldownPolicy();
    const customAttestation = attestProgressiveCooldownPolicy({
      cooldownLadderMs: [10 * MINUTE],
    });

    expect(defaultAttestation).toEqual(
      DEFAULT_PROGRESSIVE_COOLDOWN_POLICY_ATTESTATION,
    );
    expect(defaultHarness.controller.policyAttestation).toEqual(
      DEFAULT_PROGRESSIVE_COOLDOWN_POLICY_ATTESTATION,
    );
    expect(
      Reflect.set(
        defaultHarness.controller,
        "policyAttestation",
        customAttestation,
      ),
    ).toBe(false);
    expect(defaultAttestation.fingerprint).toMatch(
      /^pcp1\.[A-Za-z0-9_-]{43}$/u,
    );
    expect(defaultAttestation.fingerprint).toBe(
      "pcp1.kedBLkZvRIhieh209uVojdRBsz9hl4Hqo3ofjC0jkDM",
    );
    expect(customAttestation.fingerprint).not.toBe(
      defaultAttestation.fingerprint,
    );
    expect(customAttestation.policy.cooldownLadderMs).toEqual([10 * MINUTE]);
    expect(Object.isFrozen(defaultAttestation)).toBe(true);
    expect(Object.isFrozen(defaultAttestation.policy)).toBe(true);
    expect(Object.isFrozen(defaultAttestation.policy.cooldownLadderMs)).toBe(
      true,
    );
    expect(isProgressiveCooldownPolicyAttestation(defaultAttestation)).toBe(
      true,
    );
    expect(
      isProgressiveCooldownPolicyAttestation({
        ...defaultAttestation,
        policy: customAttestation.policy,
      }),
    ).toBe(false);
    expect(
      isProgressiveCooldownPolicyAttestation({
        ...defaultAttestation,
        unexpected: true,
      }),
    ).toBe(false);
    expect(
      isProgressiveCooldownPolicyAttestation({
        fingerprint: defaultAttestation.fingerprint,
        policy: {
          operationTimeoutMs: defaultAttestation.policy.operationTimeoutMs,
          maxRevisionConflicts:
            defaultAttestation.policy.maxRevisionConflicts,
          maxReservationRecords:
            defaultAttestation.policy.maxReservationRecords,
          reconciliationRetentionMs:
            defaultAttestation.policy.reconciliationRetentionMs,
          unavailableRetryAfterMs:
            defaultAttestation.policy.unavailableRetryAfterMs,
          reservationLeaseMs:
            defaultAttestation.policy.reservationLeaseMs,
          resetAfterMs: defaultAttestation.policy.resetAfterMs,
          cooldownLadderMs: [
            ...defaultAttestation.policy.cooldownLadderMs,
          ],
        },
        schemaVersion: "1",
      }),
    ).toBe(true);
  });

  it("reserves once and reports the exact active-lease retry", async () => {
    const testHarness = harness();
    const result = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });

    expect(result).toEqual({
      status: "reserved",
      replayed: false,
      reservationId: RESERVATION_IDS[0],
      reservedAtMs: START,
      leaseExpiresAtMs: START + 5 * MINUTE,
      attemptGeneration: 1,
      attemptToken: attemptToken(1),
    });

    testHarness.advance(1_250);
    const eligibility = await testHarness.controller.getEligibility({ scope });
    expect(eligibility).toEqual({
      status: "reservation-active",
      availableAtMs: START + 5 * MINUTE,
      retryAfterSeconds: 299,
      streak: 0,
    });
  });

  it("rounds Retry-After up so callers never retry early", async () => {
    const testHarness = harness();
    await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    testHarness.advance(1);

    const result = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(2),
    });

    expect(result.status).toBe("reservation-active");
    if (result.status === "reservation-active") {
      expect(result.retryAfterSeconds).toBe(300);
      expect(result.availableAtMs).toBe(START + 5 * MINUTE);
    }
  });

  it("replays the same reservation for the same idempotency token", async () => {
    const testHarness = harness();
    const first = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    const replay = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });

    expect(first.status).toBe("reserved");
    expect(first).toMatchObject({
      status: "reserved",
      replayed: false,
      attemptGeneration: 1,
      attemptToken: attemptToken(1),
    });
    expect(replay).toEqual({
      status: "attempt-pending",
      reservationId: RESERVATION_IDS[0],
      reservedAtMs: START,
      leaseExpiresAtMs: START + 5 * MINUTE,
    });
    expect(replay).not.toHaveProperty("attemptToken");
  });

  it("atomically begins immutable write and rejects every later release", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation owner");
    }

    const begun = await testHarness.controller.beginImmutableWrite({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });
    const release = await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });

    expect(begun).toEqual({
      status: "write-started",
      replayed: false,
      reservationId: reserved.reservationId,
      writeStartedAtMs: START,
      reconciliationUntilMs: START + 5 * MINUTE + 6 * DAY,
    });
    expect(release).toEqual({
      status: "write-in-progress",
      reservationId: reserved.reservationId,
      reconciliationUntilMs: START + 5 * MINUTE + 6 * DAY,
    });

    const state = (testHarness.store as AtomicMemoryStore).writes.at(-1);
    expect(state?.reservations[0]).toMatchObject({
      status: "writing",
      attemptGeneration: 1,
      writeStartedAtMs: START,
    });
    expect(JSON.stringify(state)).not.toContain(reserved.attemptToken);
  });

  it("rejects stale or replay-owned release authority before immutable write", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation owner");
    }

    const staleRelease = await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: attemptToken(2),
    });

    expect(staleRelease).toEqual({ status: "attempt-mismatch" });
    expect(await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    })).toMatchObject({ status: "attempt-pending" });
    expect((testHarness.store as AtomicMemoryStore).writes.at(-1)?.reservations[0])
      .toMatchObject({ status: "reserved" });
  });

  it("prevents immutable write when the owner releases before begin", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation owner");
    }

    const released = await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });
    const beginAfterRelease = await testHarness.controller.beginImmutableWrite({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });

    expect(released).toMatchObject({ status: "released", replayed: false });
    expect(beginAfterRelease).toEqual({ ...released, replayed: true });
    expect((testHarness.store as AtomicMemoryStore).writes.at(-1)?.reservations[0])
      .toMatchObject({ status: "released" });
  });

  it("allows only one concurrent reservation for a scope", async () => {
    const testHarness = harness();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        testHarness.controller.reserve({
          scope,
          idempotencyKey: token(index),
        }),
      ),
    );

    expect(
      results.filter((result) => result.status === "reserved"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "reservation-active"),
    ).toHaveLength(19);
  });

  it("requires immutable acceptance before commit", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    expect(reserved.status).toBe("reserved");
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }

    const result = await testHarness.controller.commitAccepted({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
    });

    expect(result).toEqual({ status: "acceptance-not-found" });
    expect(
      await testHarness.controller.getEligibility({ scope }),
    ).toMatchObject({
      status: "reservation-active",
    });
  });

  it("commits idempotently and starts the first cooldown only once", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    testHarness.accepted.add(reserved.reservationId);

    const [first, replay] = await Promise.all([
      testHarness.controller.commitAccepted({
        scope,
        idempotencyKey: token(1),
        reservationId: reserved.reservationId,
      }),
      testHarness.controller.commitAccepted({
        scope,
        idempotencyKey: token(1),
        reservationId: reserved.reservationId,
      }),
    ]);

    expect([first.status, replay.status]).toEqual(["committed", "committed"]);
    const commits = [first, replay].filter(
      (result): result is Extract<typeof result, { status: "committed" }> =>
        result.status === "committed",
    );
    expect(commits.map(({ replayed }) => replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(commits[0]).toMatchObject({
      reservationId: reserved.reservationId,
      streak: 1,
      cooldownDurationMs: 5 * MINUTE,
      cooldownUntilMs: START + 5 * MINUTE,
    });
  });

  it("replays a committed result without depending on the verifier", async () => {
    const store = new AtomicMemoryStore();
    const accepted = new Set<string>();
    let verifierAvailable = true;
    const controller = new OpaqueProgressiveCooldownController({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async ({ reservationId }) => {
          if (!verifierAvailable) {
            throw new Error("verifier unavailable");
          }
          return accepted.has(reservationId);
        },
      },
      clock: { nowMs: () => START },
      reservationIdFactory: () => RESERVATION_IDS[0],
    });
    const reserved = await controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    accepted.add(reserved.reservationId);
    const committed = await controller.commitAccepted({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
    });
    verifierAvailable = false;

    expect(
      await controller.commitAccepted({
        scope,
        idempotencyKey: token(1),
        reservationId: reserved.reservationId,
      }),
    ).toEqual({
      ...(committed as Extract<typeof committed, { status: "committed" }>),
      replayed: true,
    });
    expect(
      await controller.release({
        scope,
        idempotencyKey: token(1),
        reservationId: reserved.reservationId,
        attemptGeneration: reserved.attemptGeneration,
        attemptToken: reserved.attemptToken,
      }),
    ).toEqual({
      ...(committed as Extract<typeof committed, { status: "committed" }>),
      replayed: true,
    });
  });

  it("applies 5m, 15m, 1h, 6h, 24h and then caps at 24h", async () => {
    const testHarness = harness();
    const expected = [5 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR, DAY, DAY];

    for (const [index, durationMs] of expected.entries()) {
      const { committed } = await reserveAndAccept(testHarness, index);
      expect(committed.streak).toBe(Math.min(index + 1, 5));
      expect(committed.cooldownDurationMs).toBe(durationMs);
      expect(committed.cooldownUntilMs).toBe(
        committed.committedAtMs + durationMs,
      );
      testHarness.setNow(committed.cooldownUntilMs);
    }
  });

  it("never regresses a capped cooldown when delayed reconciliation commits last", async () => {
    let heldReservationId: string | undefined;
    let resolveHeldAcceptance: ((accepted: boolean) => void) | undefined;
    let markHeldVerifierStarted: (() => void) | undefined;
    const heldVerifierStarted = new Promise<void>((resolve) => {
      markHeldVerifierStarted = resolve;
    });
    const heldAcceptance = new Promise<boolean>((resolve) => {
      resolveHeldAcceptance = resolve;
    });
    const testHarness = harness({
      acceptanceVerifier: {
        hasImmutableAcceptance: async ({ reservationId: candidate }) => {
          if (candidate === heldReservationId) {
            markHeldVerifierStarted?.();
            return heldAcceptance;
          }
          return true;
        },
      },
    });

    for (let index = 0; index < 4; index += 1) {
      const { committed } = await reserveAndAccept(testHarness, index);
      testHarness.setNow(committed.cooldownUntilMs);
    }

    const held = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(10),
    });
    if (held.status !== "reserved") {
      throw new Error("expected held reservation");
    }
    heldReservationId = held.reservationId;
    await testHarness.controller.release({
      scope,
      idempotencyKey: token(10),
      reservationId: held.reservationId,
      attemptGeneration: held.attemptGeneration,
      attemptToken: held.attemptToken,
    });

    const delayedCommit = testHarness.controller.commitAccepted({
      scope,
      idempotencyKey: token(10),
      reservationId: held.reservationId,
    });
    await heldVerifierStarted;

    testHarness.advance(1_000);
    const later = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(11),
    });
    if (later.status !== "reserved") {
      throw new Error("expected later reservation");
    }
    const laterCommit = await testHarness.controller.commitAccepted({
      scope,
      idempotencyKey: token(11),
      reservationId: later.reservationId,
    });
    if (laterCommit.status !== "committed") {
      throw new Error("expected later commit");
    }

    resolveHeldAcceptance?.(true);
    const reconciledCommit = await delayedCommit;
    expect(reconciledCommit.status).toBe("committed");
    if (reconciledCommit.status !== "committed") {
      throw new Error("expected reconciled commit");
    }
    expect(reconciledCommit.committedAtMs).toBeGreaterThanOrEqual(
      laterCommit.committedAtMs,
    );
    expect(reconciledCommit.cooldownUntilMs).toBeGreaterThanOrEqual(
      laterCommit.cooldownUntilMs,
    );

    const state = (testHarness.store as AtomicMemoryStore).writes.at(-1);
    expect(state?.lastCommittedAtMs).toBe(reconciledCommit.committedAtMs);
    expect(state?.cooldownUntilMs).toBe(reconciledCommit.cooldownUntilMs);
  });

  it("fails closed when the clock moves behind persisted control events", async () => {
    const testHarness = harness();
    await reserveAndAccept(testHarness, 1);
    testHarness.setNow(START - 1);

    await expect(
      testHarness.controller.getEligibility({ scope }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("fails closed when the clock regresses after a state read", async () => {
    let clockCalls = 0;
    const controller = new OpaqueProgressiveCooldownController({
      store: {
        read: async () => ({
          revision: "revision-1",
          state: reservedControlState(),
        }),
        compareAndSwap: async () => ({ applied: false }),
      },
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => false,
      },
      clock: {
        nowMs: () => {
          clockCalls += 1;
          return clockCalls < 3 ? START : START - 1;
        },
      },
    });

    await expect(controller.getEligibility({ scope })).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("resets to the first rung after exactly 48 quiet hours", async () => {
    const testHarness = harness();
    const first = await reserveAndAccept(testHarness, 1);
    testHarness.setNow(first.committed.committedAtMs + 48 * HOUR);

    const second = await reserveAndAccept(testHarness, 2);

    expect(second.committed.streak).toBe(1);
    expect(second.committed.cooldownDurationMs).toBe(5 * MINUTE);
  });

  it("does not reset one millisecond before 48 quiet hours", async () => {
    const testHarness = harness();
    const first = await reserveAndAccept(testHarness, 1);
    testHarness.setNow(first.committed.committedAtMs + 48 * HOUR - 1);

    const second = await reserveAndAccept(testHarness, 2);

    expect(second.committed.streak).toBe(2);
    expect(second.committed.cooldownDurationMs).toBe(15 * MINUTE);
  });

  it("fails closed when zeroed state retains a commit inside the quiet-reset window", async () => {
    const committedAtMs = START - 48 * HOUR + 1;
    const reconciliationUntilMs = committedAtMs + 48 * HOUR + 6 * DAY;
    const retainedCommit: ProgressiveCooldownReservationRecord = {
      reservationId: RESERVATION_IDS[0],
      idempotencyDigest: "A".repeat(43),
      status: "committed",
      reservedAtMs: committedAtMs,
      leaseExpiresAtMs: committedAtMs + 5 * MINUTE,
      reconciliationUntilMs,
      committedAtMs,
      committedStreak: 1,
      cooldownDurationMs: 5 * MINUTE,
      cooldownUntilMs: committedAtMs + 5 * MINUTE,
    };

    await expect(
      eligibilityForPersistedState({
        schemaVersion: "1",
        streak: 0,
        reservations: [retainedCommit],
        hardDeleteByMs: reconciliationUntilMs + DAY,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("accepts zeroed state with retained commit at the exact quiet-reset boundary", async () => {
    const committedAtMs = START - 48 * HOUR;
    const reconciliationUntilMs = committedAtMs + 48 * HOUR + 6 * DAY;
    const retainedCommit: ProgressiveCooldownReservationRecord = {
      reservationId: RESERVATION_IDS[0],
      idempotencyDigest: "A".repeat(43),
      status: "committed",
      reservedAtMs: committedAtMs,
      leaseExpiresAtMs: committedAtMs + 5 * MINUTE,
      reconciliationUntilMs,
      committedAtMs,
      committedStreak: 1,
      cooldownDurationMs: 5 * MINUTE,
      cooldownUntilMs: committedAtMs + 5 * MINUTE,
    };

    await expect(
      eligibilityForPersistedState({
        schemaVersion: "1",
        streak: 0,
        reservations: [retainedCommit],
        hardDeleteByMs: reconciliationUntilMs + DAY,
      }),
    ).resolves.toEqual({ status: "available", streak: 0 });
  });

  it("returns exact cooldown eligibility and then becomes available", async () => {
    const testHarness = harness();
    const { committed } = await reserveAndAccept(testHarness, 1);
    testHarness.setNow(committed.committedAtMs + 1_001);

    expect(await testHarness.controller.getEligibility({ scope })).toEqual({
      status: "cooldown",
      availableAtMs: committed.cooldownUntilMs,
      retryAfterSeconds: 299,
      streak: 1,
    });

    testHarness.setNow(committed.cooldownUntilMs - 1);
    expect(await testHarness.controller.getEligibility({ scope })).toEqual({
      status: "cooldown",
      availableAtMs: committed.cooldownUntilMs,
      retryAfterSeconds: 1,
      streak: 1,
    });

    testHarness.setNow(committed.cooldownUntilMs);
    expect(await testHarness.controller.getEligibility({ scope })).toEqual({
      status: "available",
      streak: 1,
    });
  });

  it("releases a reservation idempotently without starting a cooldown", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }

    const first = await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });
    const replay = await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });

    expect(first).toEqual({
      status: "released",
      replayed: false,
      reservationId: reserved.reservationId,
      releasedAtMs: START,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await testHarness.controller.getEligibility({ scope })).toEqual({
      status: "available",
      streak: 0,
    });
  });

  it("promotes a released reservation when reconciliation proves acceptance", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });
    testHarness.accepted.add(reserved.reservationId);

    const reconciled = await testHarness.controller.commitAccepted({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
    });

    expect(reconciled).toMatchObject({
      status: "committed",
      replayed: false,
      reservationId: reserved.reservationId,
      streak: 1,
    });
  });

  it("keeps an expired reservation available for bounded reconciliation", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    testHarness.setNow(reserved.leaseExpiresAtMs);

    const replay = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    expect(replay).toEqual({
      status: "pending-reconciliation",
      reservationId: reserved.reservationId,
      leaseExpiredAtMs: reserved.leaseExpiresAtMs,
      reconciliationUntilMs: reserved.leaseExpiresAtMs + 6 * DAY,
    });

    testHarness.accepted.add(reserved.reservationId);
    const committed = await testHarness.controller.commitAccepted({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
    });
    expect(committed.status).toBe("committed");
  });

  it("allows six days for reconciliation and one day for verified deletion", async () => {
    expect(PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS).toBe(DAY);
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const store = testHarness.store as AtomicMemoryStore;
    const reservedState = store.writes.at(-1);
    expect(reservedState?.reservations[0]?.reconciliationUntilMs).toBe(
      reserved.leaseExpiresAtMs + 6 * DAY,
    );
    expect(reservedState?.hardDeleteByMs).toBe(
      reserved.leaseExpiresAtMs + 7 * DAY,
    );

    testHarness.accepted.add(reserved.reservationId);
    const committed = await testHarness.controller.commitAccepted({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
    });
    if (committed.status !== "committed") {
      throw new Error("expected commit");
    }
    const committedState = store.writes.at(-1);
    expect(committedState?.reservations[0]?.reconciliationUntilMs).toBe(
      committed.committedAtMs + 48 * HOUR + 6 * DAY,
    );
    expect(committedState?.hardDeleteByMs).toBe(
      committed.committedAtMs + 48 * HOUR + 7 * DAY,
    );
  });

  it("starts released-record deletion at the release instant", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    testHarness.advance(1_000);
    const released = await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });
    if (released.status !== "released") {
      throw new Error("expected release");
    }

    const state = (testHarness.store as AtomicMemoryStore).writes.at(-1);
    expect(state?.reservations[0]?.reconciliationUntilMs).toBe(
      released.releasedAtMs + 6 * DAY,
    );
    expect(state?.hardDeleteByMs).toBe(released.releasedAtMs + 7 * DAY);
  });

  it("denies new work when bounded reconciliation records reach capacity", async () => {
    const testHarness = harness({
      policy: {
        maxReservationRecords: 1,
        reservationLeaseMs: MINUTE,
        reconciliationRetentionMs: MINUTE,
      },
    });
    const first = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (first.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const persisted = (testHarness.store as AtomicMemoryStore).writes.at(-1);
    expect(persisted?.reservations[0]?.reconciliationUntilMs).toBe(
      first.leaseExpiresAtMs + MINUTE,
    );
    expect(persisted?.hardDeleteByMs).toBe(
      first.leaseExpiresAtMs + MINUTE + DAY,
    );
    testHarness.setNow(first.leaseExpiresAtMs);

    const result = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(2),
    });

    expect(result).toEqual({
      status: "control-capacity",
      availableAtMs: first.leaseExpiresAtMs + MINUTE,
      retryAfterSeconds: 60,
      streak: 0,
    });
  });

  it.each([
    [
      "short reservation lease",
      () => {
        const leaseExpiresAtMs = START + 5 * MINUTE - 1;
        const reconciliationUntilMs = leaseExpiresAtMs + 6 * DAY;
        return reservedControlState(
          { leaseExpiresAtMs, reconciliationUntilMs },
          { hardDeleteByMs: reconciliationUntilMs + DAY },
        );
      },
    ],
    [
      "long reservation lease",
      () => {
        const leaseExpiresAtMs = START + DAY;
        const reconciliationUntilMs = leaseExpiresAtMs + 6 * DAY;
        return reservedControlState(
          { leaseExpiresAtMs, reconciliationUntilMs },
          { hardDeleteByMs: reconciliationUntilMs + DAY },
        );
      },
    ],
    [
      "short reserved retention",
      () => {
        const reconciliationUntilMs = START + 5 * MINUTE + 6 * DAY - 1;
        return reservedControlState(
          { reconciliationUntilMs },
          { hardDeleteByMs: reconciliationUntilMs + DAY },
        );
      },
    ],
    [
      "year-long reserved retention",
      () => {
        const reconciliationUntilMs = START + 365 * DAY;
        return reservedControlState(
          { reconciliationUntilMs },
          { hardDeleteByMs: reconciliationUntilMs + DAY },
        );
      },
    ],
    [
      "early aggregate purge",
      () =>
        reservedControlState(
          {},
          { hardDeleteByMs: START + 5 * MINUTE + 7 * DAY - 1 },
        ),
    ],
    [
      "late aggregate purge",
      () =>
        reservedControlState(
          {},
          { hardDeleteByMs: START + 5 * MINUTE + 7 * DAY + 1 },
        ),
    ],
    [
      "future reservation event",
      () => {
        const reservedAtMs = START + 1;
        const leaseExpiresAtMs = reservedAtMs + 5 * MINUTE;
        const reconciliationUntilMs = leaseExpiresAtMs + 6 * DAY;
        return reservedControlState(
          { reservedAtMs, leaseExpiresAtMs, reconciliationUntilMs },
          { hardDeleteByMs: reconciliationUntilMs + DAY },
        );
      },
    ],
    [
      "non-canonical idempotency digest",
      () =>
        reservedControlState({
          idempotencyDigest: `${"A".repeat(42)}B`,
        }),
    ],
  ])("fails closed for a persisted %s", async (_, createState) => {
    await expect(eligibilityForPersistedState(createState())).resolves.toEqual({
      status: "unavailable",
      retryAtMs: START + 30_000,
      retryAfterSeconds: 30,
    });
  });

  it("fails closed for an unbounded empty-state purge deadline", async () => {
    await expect(
      eligibilityForPersistedState({
        schemaVersion: "1",
        streak: 0,
        reservations: [],
        hardDeleteByMs: Number.MAX_SAFE_INTEGER,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it.each([
    [
      "release",
      () => {
        const releasedAtMs = START + 1;
        const reconciliationUntilMs = releasedAtMs + 6 * DAY;
        return reservedControlState(
          {
            status: "released",
            releasedAtMs,
            reconciliationUntilMs,
          },
          { hardDeleteByMs: reconciliationUntilMs + DAY },
        );
      },
    ],
    [
      "commit",
      () => {
        const committedAtMs = START + 1;
        const cooldownUntilMs = committedAtMs + 5 * MINUTE;
        const reconciliationUntilMs = committedAtMs + 48 * HOUR + 6 * DAY;
        const record: ProgressiveCooldownReservationRecord = {
          ...reservedControlState().reservations[0]!,
          status: "committed",
          committedAtMs,
          committedStreak: 1,
          cooldownDurationMs: 5 * MINUTE,
          cooldownUntilMs,
          reconciliationUntilMs,
        };
        return {
          schemaVersion: "1" as const,
          streak: 1,
          lastCommittedAtMs: committedAtMs,
          cooldownUntilMs,
          reservations: [record],
          hardDeleteByMs: reconciliationUntilMs + DAY,
        };
      },
    ],
  ])("fails closed for a future persisted %s event", async (_, createState) => {
    await expect(
      eligibilityForPersistedState(createState()),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("fails closed when retained commit history skips the required ladder transition", async () => {
    const earlierCommittedAtMs = START - 2 * MINUTE;
    const latestCommittedAtMs = START - MINUTE;
    const earlier: ProgressiveCooldownReservationRecord = {
      reservationId: RESERVATION_IDS[0],
      idempotencyDigest: "A".repeat(43),
      status: "committed",
      reservedAtMs: earlierCommittedAtMs,
      leaseExpiresAtMs: earlierCommittedAtMs + 5 * MINUTE,
      reconciliationUntilMs: earlierCommittedAtMs + 48 * HOUR + 6 * DAY,
      committedAtMs: earlierCommittedAtMs,
      committedStreak: 5,
      cooldownDurationMs: DAY,
      cooldownUntilMs: earlierCommittedAtMs + DAY,
    };
    const latest: ProgressiveCooldownReservationRecord = {
      reservationId: RESERVATION_IDS[1],
      idempotencyDigest: "E".repeat(43),
      status: "committed",
      reservedAtMs: latestCommittedAtMs,
      leaseExpiresAtMs: latestCommittedAtMs + 5 * MINUTE,
      reconciliationUntilMs: latestCommittedAtMs + 48 * HOUR + 6 * DAY,
      committedAtMs: latestCommittedAtMs,
      committedStreak: 1,
      cooldownDurationMs: 5 * MINUTE,
      cooldownUntilMs: latestCommittedAtMs + 5 * MINUTE,
    };
    const corruptState: ProgressiveCooldownState = {
      schemaVersion: "1",
      streak: 1,
      lastCommittedAtMs: latestCommittedAtMs,
      cooldownUntilMs: latest.cooldownUntilMs,
      reservations: [earlier, latest],
      hardDeleteByMs: latest.reconciliationUntilMs + DAY,
    };

    await expect(
      eligibilityForPersistedState(corruptState),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("fails closed for unknown persisted snapshot or state fields", async () => {
    const stateWithUnknownField = {
      ...reservedControlState(),
      narrative: "must never enter control storage",
    } as unknown as ProgressiveCooldownState;
    await expect(
      eligibilityForPersistedState(stateWithUnknownField),
    ).resolves.toMatchObject({ status: "unavailable" });

    const controller = new OpaqueProgressiveCooldownController({
      store: {
        read: async () =>
          ({
            revision: "revision-1",
            state: reservedControlState(),
            accountId: "must-not-be-accepted",
          }) as ProgressiveCooldownSnapshot,
        compareAndSwap: async () => ({ applied: false }),
      },
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => false,
      },
      clock: { nowMs: () => START },
    });
    await expect(controller.getEligibility({ scope })).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it.each([-1, 1])(
    "rejects released retention that differs from the exact deadline by %ims",
    async (deltaMs) => {
      const testHarness = harness();
      const reserved = await testHarness.controller.reserve({
        scope,
        idempotencyKey: token(1),
      });
      if (reserved.status !== "reserved") {
        throw new Error("expected reservation");
      }
      await testHarness.controller.release({
        scope,
        idempotencyKey: token(1),
        reservationId: reserved.reservationId,
        attemptGeneration: reserved.attemptGeneration,
        attemptToken: reserved.attemptToken,
      });
      const state = (testHarness.store as AtomicMemoryStore).writes.at(-1);
      const record = state?.reservations[0];
      if (!state || !record) {
        throw new Error("expected released state");
      }
      const reconciliationUntilMs = record.reconciliationUntilMs + deltaMs;
      const corruptState = {
        ...state,
        reservations: [{ ...record, reconciliationUntilMs }],
        hardDeleteByMs: reconciliationUntilMs + DAY,
      };

      await expect(
        eligibilityForPersistedState(corruptState),
      ).resolves.toMatchObject({ status: "unavailable" });
    },
  );

  it.each([-1, 1])(
    "rejects committed retention that differs from the exact deadline by %ims",
    async (deltaMs) => {
      const testHarness = harness();
      const { committed } = await reserveAndAccept(testHarness, 1);
      const state = (testHarness.store as AtomicMemoryStore).writes.at(-1);
      const record = state?.reservations[0];
      if (!state || !record) {
        throw new Error("expected committed state");
      }
      const reconciliationUntilMs = record.reconciliationUntilMs + deltaMs;
      const corruptState = {
        ...state,
        reservations: [{ ...record, reconciliationUntilMs }],
        hardDeleteByMs: reconciliationUntilMs + DAY,
      };

      await expect(
        eligibilityForPersistedState(corruptState, committed.committedAtMs),
      ).resolves.toMatchObject({ status: "unavailable" });
    },
  );

  it.each([-1, 1])(
    "rejects committed cooldown expiry that differs from its rung by %ims",
    async (deltaMs) => {
      const testHarness = harness();
      const { committed } = await reserveAndAccept(testHarness, 1);
      const state = (testHarness.store as AtomicMemoryStore).writes.at(-1);
      const record = state?.reservations[0];
      if (!state || !record || record.status !== "committed") {
        throw new Error("expected committed state");
      }
      const cooldownUntilMs = (record.cooldownUntilMs ?? 0) + deltaMs;
      const corruptState = {
        ...state,
        cooldownUntilMs,
        reservations: [{ ...record, cooldownUntilMs }],
      };

      await expect(
        eligibilityForPersistedState(corruptState, committed.committedAtMs),
      ).resolves.toMatchObject({ status: "unavailable" });
    },
  );

  it("does not persist the source subject, purpose, or idempotency token", async () => {
    const testHarness = harness();
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation owner");
    }

    const memoryStore = testHarness.store as AtomicMemoryStore;
    const persisted = JSON.stringify({
      keys: memoryStore.keys,
      writes: memoryStore.writes,
    });

    expect(persisted).not.toContain(scope.opaqueSubjectKey);
    expect(persisted).not.toContain(scope.purpose);
    expect(persisted).not.toContain(token(1));
    expect(persisted).not.toContain(reserved.attemptToken);
    expect(memoryStore.keys[0]).toMatch(
      /^fbs1\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u,
    );
    const expectedStateKey = createHash("sha256")
      .update("opaque-progressive-cooldown:v1", "utf8")
      .update("\0", "utf8")
      .update(scope.version, "utf8")
      .update("\0", "utf8")
      .update(scope.purpose, "utf8")
      .update("\0", "utf8")
      .update(scope.opaqueSubjectKey, "utf8")
      .digest("base64url");
    expect(memoryStore.keys[0]).toBe(`fbs1.${expectedStateKey}`);
    const encodedStateKey = memoryStore.keys[0]?.slice("fbs1.".length);
    expect(Buffer.from(encodedStateKey ?? "", "base64url")).toHaveLength(32);
    expect(
      Buffer.from(encodedStateKey ?? "", "base64url").toString("base64url"),
    ).toBe(encodedStateKey);
  });

  it("uses canonical entity-manager wire identifiers by default", async () => {
    const store = new AtomicMemoryStore();
    const controller = new OpaqueProgressiveCooldownController({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => false,
      },
      clock: { nowMs: () => START },
    });

    const reserved = await controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    expect(reserved.status).toBe("reserved");
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    expect(reserved.reservationId).toMatch(/^fbr1\.[A-Za-z0-9_-]{21}[AQgw]$/u);
    expect(reserved.attemptToken).toMatch(/^fba1\.[A-Za-z0-9_-]{21}[AQgw]$/u);
    const encodedReservationId = reserved.reservationId.slice("fbr1.".length);
    expect(Buffer.from(encodedReservationId, "base64url")).toHaveLength(16);
    expect(
      Buffer.from(encodedReservationId, "base64url").toString("base64url"),
    ).toBe(encodedReservationId);
    const encodedAttemptToken = reserved.attemptToken.slice("fba1.".length);
    expect(Buffer.from(encodedAttemptToken, "base64url")).toHaveLength(16);
    expect(
      Buffer.from(encodedAttemptToken, "base64url").toString("base64url"),
    ).toBe(encodedAttemptToken);
  });

  it("isolates otherwise identical opaque subjects by purpose and version", async () => {
    const testHarness = harness();
    await testHarness.controller.getEligibility({ scope });
    await testHarness.controller.getEligibility({
      scope: { ...scope, purpose: "submission.review" },
    });
    await testHarness.controller.getEligibility({
      scope: { ...scope, version: "v2" },
    });

    const keys = (testHarness.store as AtomicMemoryStore).keys;
    expect(new Set(keys).size).toBe(3);
  });

  it.each([
    ["raw account ID", "user-123"],
    ["email", "person@example.com"],
    ["IPv4", "203.0.113.10"],
    ["fingerprint", "Mozilla/5.0"],
    ["wrong byte length", "A".repeat(42)],
    ["padded base64", `${"A".repeat(42)}=`],
    ["non-canonical base64url alias", `${"A".repeat(42)}B`],
  ])(
    "rejects a %s instead of accepting it as an opaque subject",
    async (_, value) => {
      const testHarness = harness();
      await expect(
        testHarness.controller.reserve({
          scope: { ...scope, opaqueSubjectKey: value },
          idempotencyKey: token(1),
        }),
      ).rejects.toMatchObject({
        name: "ProgressiveCooldownInputError",
        code: "invalid-opaque-subject",
        message: "Invalid progressive cooldown input.",
      });
    },
  );

  it("uses closed validation errors without reflecting unsafe input", async () => {
    const testHarness = harness();
    const unsafe = "unsafe/value?email=person@example.com";

    await expect(
      testHarness.controller.reserve({
        scope: { ...scope, purpose: unsafe },
        idempotencyKey: token(1),
      }),
    ).rejects.not.toThrow(unsafe);
    await expect(
      testHarness.controller.reserve({
        scope,
        idempotencyKey: "person@example.com",
      }),
    ).rejects.toBeInstanceOf(ProgressiveCooldownInputError);
    await expect(
      testHarness.controller.release({
        scope,
        idempotencyKey: token(1),
        reservationId: `fbr1.${"A".repeat(21)}B`,
        attemptGeneration: 1,
        attemptToken: attemptToken(1),
      }),
    ).rejects.toMatchObject({
      code: "invalid-reservation-id",
      message: "Invalid progressive cooldown input.",
    });
  });

  it("fails closed when the store read is unavailable", async () => {
    const testHarness = harness({
      store: {
        read: async () => {
          throw new Error(`dependency leaked ${SUBJECT}`);
        },
        compareAndSwap: async () => ({ applied: true, revision: "revision-1" }),
      },
    });

    await expect(
      testHarness.controller.reserve({
        scope,
        idempotencyKey: token(1),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      retryAtMs: START + 30_000,
      retryAfterSeconds: 30,
    });
  });

  it("bounds a store that ignores cancellation and never settles", async () => {
    let observedSignal: AbortSignal | undefined;
    let observedDeadline: number | undefined;
    const testHarness = harness({
      store: {
        read: async (_stateKey, context) => {
          observedSignal = context.signal;
          observedDeadline = context.deadlineAtMs;
          return new Promise<ProgressiveCooldownSnapshot | null>(() => {
            // Intentionally unsettled: the controller deadline must win.
          });
        },
        compareAndSwap: async () => ({ applied: false }),
      },
      policy: { operationTimeoutMs: 10 },
    });

    const result = await testHarness.controller.getEligibility({ scope });

    expect(result).toMatchObject({ status: "unavailable" });
    expect(observedSignal?.aborted).toBe(true);
    expect(observedDeadline).toBe(START + 10);
  });

  it("honours caller cancellation and propagates its own aborted signal", async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    let storeSignal: AbortSignal | undefined;
    const testHarness = harness({
      store: {
        read: async (_stateKey, context) => {
          storeSignal = context.signal;
          return null;
        },
        compareAndSwap: async () => ({ applied: false }),
      },
    });

    const result = await testHarness.controller.getEligibility({
      scope,
      signal: cancellation.signal,
    });

    expect(result).toMatchObject({ status: "unavailable" });
    expect(storeSignal).toBeUndefined();
  });

  it("converges when an ambiguous reservation write completes after cancellation", async () => {
    let state: ProgressiveCooldownState | undefined;
    let revision = 0;
    let releaseWrite: (() => void) | undefined;
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const store: ProgressiveCooldownStore = {
      read: async () =>
        state
          ? {
              revision: String(revision),
              state: cloneState(state),
            }
          : null,
      compareAndSwap: async (input) => {
        markWriteStarted?.();
        await writeGate;
        state = cloneState(input.state);
        revision += 1;
        return { applied: true, revision: String(revision) };
      },
    };
    const testHarness = harness({ store });
    const cancellation = new AbortController();
    const pending = testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
      signal: cancellation.signal,
    });
    await writeStarted;
    cancellation.abort();

    await expect(pending).resolves.toMatchObject({ status: "unavailable" });
    releaseWrite?.();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    await expect(
      testHarness.controller.reserve({
        scope,
        idempotencyKey: token(1),
      }),
    ).resolves.toMatchObject({
      status: "attempt-pending",
      reservationId: RESERVATION_IDS[0],
    });
  });

  it("recovers an ambiguous begin-write CAS without reopening release authority", async () => {
    let state: ProgressiveCooldownState | undefined;
    let revision = 0;
    let holdNextWrite = false;
    let releaseWrite: (() => void) | undefined;
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const store: ProgressiveCooldownStore = {
      read: async () => state
        ? { revision: String(revision), state: cloneState(state) }
        : null,
      compareAndSwap: async (input) => {
        if (holdNextWrite) {
          holdNextWrite = false;
          markWriteStarted?.();
          await writeGate;
        }
        if ((state === undefined ? null : String(revision)) !== input.expectedRevision) {
          return { applied: false };
        }
        state = cloneState(input.state);
        revision += 1;
        return { applied: true, revision: String(revision) };
      },
    };
    const testHarness = harness({ store });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation owner");
    }

    holdNextWrite = true;
    const cancellation = new AbortController();
    const pendingBegin = testHarness.controller.beginImmutableWrite({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
      signal: cancellation.signal,
    });
    await writeStarted;
    cancellation.abort();
    await expect(pendingBegin).resolves.toMatchObject({ status: "unavailable" });

    releaseWrite?.();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    await expect(testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    })).resolves.toMatchObject({ status: "pending-reconciliation" });
    await expect(testHarness.controller.beginImmutableWrite({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    })).resolves.toMatchObject({ status: "write-started", replayed: true });
    await expect(testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    })).resolves.toMatchObject({ status: "write-in-progress" });
  });

  it("fails closed when compare-and-swap is unavailable", async () => {
    const testHarness = harness({
      store: {
        read: async () => null,
        compareAndSwap: async () => {
          throw new Error(`write leaked ${token(1)}`);
        },
      },
    });

    expect(
      await testHarness.controller.reserve({
        scope,
        idempotencyKey: token(1),
      }),
    ).toEqual({
      status: "unavailable",
      retryAtMs: START + 30_000,
      retryAfterSeconds: 30,
    });
  });

  it("fails closed after bounded revision conflicts", async () => {
    let writes = 0;
    const testHarness = harness({
      store: {
        read: async () => null,
        compareAndSwap: async () => {
          writes += 1;
          return { applied: false };
        },
      },
      policy: { maxRevisionConflicts: 3 },
    });

    const result = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });

    expect(result.status).toBe("unavailable");
    expect(writes).toBe(3);
  });

  it("fails closed when a successful store write omits its revision", async () => {
    const testHarness = harness({
      store: {
        read: async () => null,
        compareAndSwap: async () =>
          ({ applied: true }) as Awaited<
            ReturnType<ProgressiveCooldownStore["compareAndSwap"]>
          >,
      },
    });

    expect(
      await testHarness.controller.reserve({
        scope,
        idempotencyKey: token(1),
      }),
    ).toMatchObject({ status: "unavailable" });
  });

  it("fails closed when a successful update reuses the expected revision", async () => {
    let revision = "revision-1";
    let state: ProgressiveCooldownState | undefined;
    const store: ProgressiveCooldownStore = {
      read: async () =>
        state
          ? {
              revision,
              state: cloneState(state),
            }
          : null,
      compareAndSwap: async (input) => {
        state = cloneState(input.state);
        if (input.expectedRevision === null) {
          return { applied: true, revision };
        }
        return {
          applied: true,
          revision: input.expectedRevision,
        };
      },
    };
    const testHarness = harness({ store });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }

    expect(
      await testHarness.controller.release({
        scope,
        idempotencyKey: token(1),
        reservationId: reserved.reservationId,
        attemptGeneration: reserved.attemptGeneration,
        attemptToken: reserved.attemptToken,
      }),
    ).toEqual({
      status: "unavailable",
      retryAtMs: START + 30_000,
      retryAfterSeconds: 30,
    });
    expect(revision).toBe("revision-1");
  });

  it("fails closed when immutable-acceptance verification is unavailable", async () => {
    const store = new AtomicMemoryStore();
    let nowMs = START;
    const controller = new OpaqueProgressiveCooldownController({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => {
          throw new Error(`verifier leaked ${SUBJECT}`);
        },
      },
      clock: { nowMs: () => nowMs },
      reservationIdFactory: () => RESERVATION_IDS[0],
    });
    const reserved = await controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    nowMs += 5;

    expect(
      await controller.commitAccepted({
        scope,
        idempotencyKey: token(1),
        reservationId: reserved.reservationId,
      }),
    ).toEqual({
      status: "unavailable",
      retryAtMs: nowMs + 30_000,
      retryAfterSeconds: 30,
    });
  });

  it("reconciles immutable acceptance using only isolated state and reservation identifiers", async () => {
    const store = new AtomicMemoryStore();
    const verifierCalls: Array<{
      stateKey: string;
      reservationId: string;
      signal: AbortSignal;
      deadlineAtMs: number;
    }> = [];
    let accepted = false;
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async (input) => {
          verifierCalls.push(input);
          return accepted;
        },
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    await testHarness.controller.beginImmutableWrite({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }
    accepted = true;

    const result = await testHarness.controller.reconcileImmutableAcceptance({
      stateKey,
      reservationId: reserved.reservationId,
    });

    expect(result).toMatchObject({
      status: "committed",
      replayed: false,
      reservationId: reserved.reservationId,
      streak: 1,
      cooldownDurationMs: 5 * MINUTE,
    });
    expect(verifierCalls).toHaveLength(1);
    expect(verifierCalls[0]).toMatchObject({
      stateKey,
      reservationId: reserved.reservationId,
      deadlineAtMs: START + 2_000,
    });
    expect(verifierCalls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(verifierCalls[0] ?? {}).sort()).toEqual([
      "deadlineAtMs",
      "reservationId",
      "signal",
      "stateKey",
    ]);
    const persisted = store.records.get(stateKey)?.state;
    expect(persisted?.streak).toBe(1);
    expect(persisted?.reservations[0]?.status).toBe("committed");
  });

  it("keeps unaccepted isolated reconciliation pending without mutating control state", async () => {
    const store = new AtomicMemoryStore();
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => false,
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }
    const writeCount = store.writes.length;

    await expect(
      testHarness.controller.reconcileImmutableAcceptance({
        stateKey,
        reservationId: reserved.reservationId,
      }),
    ).resolves.toEqual({
      status: "pending-reconciliation",
      reservationId: reserved.reservationId,
      leaseExpiredAtMs: reserved.leaseExpiresAtMs,
      reconciliationUntilMs: reserved.leaseExpiresAtMs + 6 * DAY,
    });
    expect(store.writes).toHaveLength(writeCount);
  });

  it("expires a writing reservation at the exact reconciliation boundary without verifying content", async () => {
    const store = new AtomicMemoryStore();
    let verifierCalls = 0;
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => {
          verifierCalls += 1;
          return true;
        },
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    await testHarness.controller.beginImmutableWrite({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
      attemptGeneration: reserved.attemptGeneration,
      attemptToken: reserved.attemptToken,
    });
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }
    const reconciliationUntilMs = reserved.leaseExpiresAtMs + 6 * DAY;
    testHarness.setNow(reconciliationUntilMs);

    await expect(
      testHarness.controller.reconcileImmutableAcceptance({
        stateKey,
        reservationId: reserved.reservationId,
      }),
    ).resolves.toEqual({
      status: "expired",
      reservationId: reserved.reservationId,
      expiredAtMs: reconciliationUntilMs,
    });
    expect(verifierCalls).toBe(0);
    expect(store.records.get(stateKey)?.state).toEqual({
      schemaVersion: "1",
      streak: 0,
      reservations: [],
      hardDeleteByMs: reconciliationUntilMs,
    });
    await expect(
      testHarness.controller.reconcileImmutableAcceptance({
        stateKey,
        reservationId: reserved.reservationId,
      }),
    ).resolves.toEqual({ status: "reservation-not-found" });
  });

  it("expires deterministically when bounded verification crosses the reconciliation boundary", async () => {
    const store = new AtomicMemoryStore();
    let crossBoundary: (() => void) | undefined;
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => {
          crossBoundary?.();
          return true;
        },
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }
    const reconciliationUntilMs = reserved.leaseExpiresAtMs + 6 * DAY;
    testHarness.setNow(reconciliationUntilMs - 1);
    crossBoundary = () => testHarness.setNow(reconciliationUntilMs);

    await expect(
      testHarness.controller.reconcileImmutableAcceptance({
        stateKey,
        reservationId: reserved.reservationId,
      }),
    ).resolves.toEqual({
      status: "expired",
      reservationId: reserved.reservationId,
      expiredAtMs: reconciliationUntilMs,
    });
  });

  it("replays an already committed isolated reconciliation without consulting storage content", async () => {
    const store = new AtomicMemoryStore();
    let verifierCalls = 0;
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async ({ reservationId }) => {
          verifierCalls += 1;
          return verifierCalls === 1 && reservationId === RESERVATION_IDS[0];
        },
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const committed = await testHarness.controller.commitAccepted({
      scope,
      idempotencyKey: token(1),
      reservationId: reserved.reservationId,
    });
    expect(committed.status).toBe("committed");
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }

    const replay = await testHarness.controller.reconcileImmutableAcceptance({
      stateKey,
      reservationId: reserved.reservationId,
    });

    expect(replay).toEqual({ ...committed, replayed: true });
    expect(verifierCalls).toBe(1);
  });

  it("rejects identity-bearing, malformed, accessor, and fake-signal reconciliation commands before I/O", async () => {
    const store = new AtomicMemoryStore();
    let verifierCalls = 0;
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => {
          verifierCalls += 1;
          return true;
        },
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }
    store.keys.length = 0;
    const baselineWrites = store.writes.length;
    let getterCalls = 0;
    const accessorCommand = Object.defineProperty(
      { reservationId: reserved.reservationId },
      "stateKey",
      {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return stateKey;
        },
      },
    );
    const badCommands: ReadonlyArray<[unknown, string]> = [
      [
        { stateKey: SUBJECT, reservationId: reserved.reservationId },
        "invalid-state-key",
      ],
      [{ stateKey, reservationId: SUBJECT }, "invalid-reservation-id"],
      [
        {
          stateKey,
          reservationId: reserved.reservationId,
          idempotencyKey: token(1),
        },
        "invalid-reconciliation-command",
      ],
      [
        { stateKey, reservationId: reserved.reservationId, scope },
        "invalid-reconciliation-command",
      ],
      [
        {
          stateKey,
          reservationId: reserved.reservationId,
          signal: { aborted: false },
        },
        "invalid-reconciliation-command",
      ],
      [accessorCommand, "invalid-reconciliation-command"],
      [
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error(`identity ${SUBJECT}`);
            },
          },
        ),
        "invalid-reconciliation-command",
      ],
    ];

    for (const [command, code] of badCommands) {
      await expect(
        testHarness.controller.reconcileImmutableAcceptance(command as never),
      ).rejects.toMatchObject({
        code,
        name: "ProgressiveCooldownInputError",
        message: "Invalid progressive cooldown input.",
      });
    }
    expect(getterCalls).toBe(0);
    expect(store.keys).toEqual([]);
    expect(store.writes).toHaveLength(baselineWrites);
    expect(verifierCalls).toBe(0);
  });

  it("converges concurrent identifier-isolated reconciliation to one commit", async () => {
    const store = new AtomicMemoryStore();
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => true,
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }

    const results = await Promise.all([
      testHarness.controller.reconcileImmutableAcceptance({
        stateKey,
        reservationId: reserved.reservationId,
      }),
      testHarness.controller.reconcileImmutableAcceptance({
        stateKey,
        reservationId: reserved.reservationId,
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "committed",
      "committed",
    ]);
    expect(
      results
        .filter((result) => result.status === "committed")
        .map((result) => result.replayed)
        .sort(),
    ).toEqual([false, true]);
    expect(store.records.get(stateKey)?.state.streak).toBe(1);
  });

  it("fails isolated reconciliation closed without reflecting verifier failures", async () => {
    const store = new AtomicMemoryStore();
    const testHarness = harness({
      store,
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => {
          throw new Error(`sensitive verifier value ${SUBJECT}`);
        },
      },
    });
    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    const stateKey = store.keys[0];
    if (!stateKey) {
      throw new Error("expected state key");
    }
    const writeCount = store.writes.length;

    await expect(
      testHarness.controller.reconcileImmutableAcceptance({
        stateKey,
        reservationId: reserved.reservationId,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      retryAtMs: START + 30_000,
      retryAfterSeconds: 30,
    });
    expect(store.writes).toHaveLength(writeCount);
  });

  it("fails closed for corrupt persisted state", async () => {
    const testHarness = harness({
      store: {
        read: async () =>
          ({
            revision: "revision-1",
            state: {
              schemaVersion: "1",
              streak: -1,
              reservations: [],
              hardDeleteByMs: START,
            },
          }) as ProgressiveCooldownSnapshot,
        compareAndSwap: async () => ({ applied: true, revision: "revision-2" }),
      },
    });

    expect(await testHarness.controller.getEligibility({ scope })).toEqual({
      status: "unavailable",
      retryAtMs: START + 30_000,
      retryAfterSeconds: 30,
    });
  });

  it("returns safe not-found and mismatch results", async () => {
    const testHarness = harness();
    const missing = await testHarness.controller.release({
      scope,
      idempotencyKey: token(1),
      reservationId: RESERVATION_IDS[0],
      attemptGeneration: 1,
      attemptToken: attemptToken(1),
    });
    expect(missing).toEqual({ status: "reservation-not-found" });

    const reserved = await testHarness.controller.reserve({
      scope,
      idempotencyKey: token(1),
    });
    if (reserved.status !== "reserved") {
      throw new Error("expected reservation");
    }
    expect(
      await testHarness.controller.release({
        scope,
        idempotencyKey: token(2),
        reservationId: reserved.reservationId,
        attemptGeneration: reserved.attemptGeneration,
        attemptToken: reserved.attemptToken,
      }),
    ).toEqual({ status: "reservation-mismatch" });
  });

  it("rejects unsafe policy and runtime dependency values", () => {
    const store = new AtomicMemoryStore();
    const acceptanceVerifier: ImmutableAcceptanceVerifier = {
      hasImmutableAcceptance: async () => true,
    };

    expect(
      () =>
        new OpaqueProgressiveCooldownController({
          store,
          acceptanceVerifier,
          policy: { cooldownLadderMs: [5 * MINUTE, DAY + 1] },
        }),
    ).toThrowError(ProgressiveCooldownInputError);
    expect(
      () =>
        new OpaqueProgressiveCooldownController({
          store,
          acceptanceVerifier,
          policy: { cooldownLadderMs: [15 * MINUTE, 5 * MINUTE] },
        }),
    ).toThrowError(ProgressiveCooldownInputError);
    expect(
      () =>
        new OpaqueProgressiveCooldownController({
          store,
          acceptanceVerifier,
          policy: { reconciliationRetentionMs: 6 * DAY + 1 },
        }),
    ).toThrowError(ProgressiveCooldownInputError);
    expect(
      () =>
        new OpaqueProgressiveCooldownController({
          store,
          acceptanceVerifier,
          clock: { nowMs: () => Number.NaN },
        }),
    ).not.toThrow();
  });

  it("fails closed when an injected clock or ID factory misbehaves", async () => {
    const store = new AtomicMemoryStore();
    const acceptanceVerifier: ImmutableAcceptanceVerifier = {
      hasImmutableAcceptance: async () => true,
    };
    const badClock = new OpaqueProgressiveCooldownController({
      store,
      acceptanceVerifier,
      clock: { nowMs: () => Number.NaN },
    });
    expect(await badClock.getEligibility({ scope })).toEqual({
      status: "unavailable",
      retryAfterSeconds: 30,
    });

    const badId = new OpaqueProgressiveCooldownController({
      store: new AtomicMemoryStore(),
      acceptanceVerifier,
      clock: { nowMs: () => START },
      reservationIdFactory: () => SUBJECT,
    });
    expect(
      await badId.reserve({ scope, idempotencyKey: token(1) }),
    ).toMatchObject({ status: "unavailable" });

    const badAttempt = new OpaqueProgressiveCooldownController({
      store: new AtomicMemoryStore(),
      acceptanceVerifier,
      clock: { nowMs: () => START },
      reservationIdFactory: () => RESERVATION_IDS[0],
      attemptTokenFactory: () => SUBJECT,
    });
    expect(
      await badAttempt.reserve({ scope, idempotencyKey: token(1) }),
    ).toMatchObject({ status: "unavailable" });
  });

  it("fails closed before storage when clock arithmetic would overflow", async () => {
    let storeCalls = 0;
    const controller = new OpaqueProgressiveCooldownController({
      store: {
        read: async () => {
          storeCalls += 1;
          return null;
        },
        compareAndSwap: async () => {
          storeCalls += 1;
          return { applied: false };
        },
      },
      acceptanceVerifier: {
        hasImmutableAcceptance: async () => false,
      },
      clock: { nowMs: () => Number.MAX_SAFE_INTEGER },
    });

    expect(
      await controller.reserve({
        scope,
        idempotencyKey: token(1),
      }),
    ).toEqual({
      status: "unavailable",
      retryAfterSeconds: 30,
    });
    expect(storeCalls).toBe(0);
  });
});
