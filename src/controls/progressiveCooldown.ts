import { createHash, randomBytes } from "node:crypto";

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const MAX_PROGRESSIVE_COOLDOWN_MS = DAY_MS;
/** Reserved for verified deletion and isolated-control backup expiry. */
export const PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS = DAY_MS;

export interface ProgressiveCooldownPolicy {
  readonly cooldownLadderMs: readonly number[];
  readonly resetAfterMs: number;
  readonly reservationLeaseMs: number;
  readonly unavailableRetryAfterMs: number;
  readonly reconciliationRetentionMs: number;
  readonly maxReservationRecords: number;
  readonly maxRevisionConflicts: number;
  readonly operationTimeoutMs: number;
}

export const DEFAULT_PROGRESSIVE_COOLDOWN_POLICY: ProgressiveCooldownPolicy =
  Object.freeze({
    cooldownLadderMs: Object.freeze([
      5 * MINUTE_MS,
      15 * MINUTE_MS,
      HOUR_MS,
      6 * HOUR_MS,
      DAY_MS,
    ]),
    resetAfterMs: 48 * HOUR_MS,
    reservationLeaseMs: 5 * MINUTE_MS,
    unavailableRetryAfterMs: 30 * SECOND_MS,
    reconciliationRetentionMs: 6 * DAY_MS,
    maxReservationRecords: 64,
    maxRevisionConflicts: 5,
    operationTimeoutMs: 2 * SECOND_MS,
  });

export type ProgressiveCooldownInputErrorCode =
  | "invalid-idempotency-key"
  | "invalid-opaque-subject"
  | "invalid-policy"
  | "invalid-purpose"
  | "invalid-reservation-id"
  | "invalid-version";

export class ProgressiveCooldownInputError extends Error {
  readonly code: ProgressiveCooldownInputErrorCode;

  constructor(code: ProgressiveCooldownInputErrorCode) {
    super("Invalid progressive cooldown input.");
    this.name = "ProgressiveCooldownInputError";
    this.code = code;
  }
}

export interface ProgressiveCooldownScope {
  /**
   * A closed, non-personal control purpose such as `submission.bug`.
   */
  readonly purpose: string;
  /**
   * A derivation version such as `v1`.
   */
  readonly version: string;
  /**
   * An already purpose/version-scoped 256-bit keyed pseudonym encoded as
   * unpadded base64url. Raw identifiers and request telemetry are prohibited.
   */
  readonly opaqueSubjectKey: string;
}

export type ProgressiveCooldownReservationStatus =
  | "reserved"
  | "committed"
  | "released";

export interface ProgressiveCooldownReservationRecord {
  /** Canonical `fbr1`-prefixed random 128-bit identifier. */
  readonly reservationId: string;
  readonly idempotencyDigest: string;
  readonly status: ProgressiveCooldownReservationStatus;
  readonly reservedAtMs: number;
  readonly leaseExpiresAtMs: number;
  /** Last instant at which late immutable-acceptance reconciliation is valid. */
  readonly reconciliationUntilMs: number;
  readonly committedAtMs?: number;
  readonly committedStreak?: number;
  readonly cooldownDurationMs?: number;
  readonly cooldownUntilMs?: number;
  readonly releasedAtMs?: number;
}

/**
 * Persisted control-plane state. It is pseudonymous personal data and must be
 * isolated from content, logs, analytics, and public/admin projections.
 */
export interface ProgressiveCooldownState {
  readonly schemaVersion: "1";
  readonly streak: number;
  readonly lastCommittedAtMs?: number;
  readonly cooldownUntilMs?: number;
  readonly reservations: readonly ProgressiveCooldownReservationRecord[];
  /**
   * Live deletion begins one fixed safety window before this absolute deadline.
   * Live data and bounded backups must be absent no later than this timestamp.
   */
  readonly hardDeleteByMs: number;
}

export interface ProgressiveCooldownSnapshot {
  /** Opaque revision that must change after every successful update. */
  readonly revision: string;
  readonly state: ProgressiveCooldownState;
}

export interface ProgressiveCooldownOperationContext {
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
}

export interface ProgressiveCooldownStore {
  read(
    stateKey: string,
    context: ProgressiveCooldownOperationContext,
  ): Promise<ProgressiveCooldownSnapshot | null>;
  compareAndSwap(
    input: {
      readonly stateKey: string;
      readonly expectedRevision: string | null;
      readonly state: ProgressiveCooldownState;
    },
    context: ProgressiveCooldownOperationContext,
  ): Promise<
    | {
        readonly applied: true;
        readonly revision: string;
      }
    | {
        readonly applied: false;
      }
  >;
}

export interface ImmutableAcceptanceVerifier {
  hasImmutableAcceptance(input: {
    /**
     * A purpose/version-isolated digest, never the caller's opaque subject.
     */
    readonly stateKey: string;
    readonly reservationId: string;
    readonly signal: AbortSignal;
    readonly deadlineAtMs: number;
  }): Promise<boolean>;
}

export interface ProgressiveCooldownClock {
  nowMs(): number;
}

export interface OpaqueProgressiveCooldownControllerOptions {
  readonly store: ProgressiveCooldownStore;
  readonly acceptanceVerifier: ImmutableAcceptanceVerifier;
  readonly clock?: ProgressiveCooldownClock;
  /** Test/infrastructure hook; output must be a canonical random `fbr1` ID. */
  readonly reservationIdFactory?: () => string;
  readonly policy?: Partial<ProgressiveCooldownPolicy>;
}

export interface ProgressiveCooldownScopeCommand {
  readonly scope: ProgressiveCooldownScope;
  readonly signal?: AbortSignal;
}

export interface ProgressiveCooldownReservationCommand extends ProgressiveCooldownScopeCommand {
  readonly idempotencyKey: string;
}

export interface ProgressiveCooldownTransitionCommand extends ProgressiveCooldownReservationCommand {
  readonly reservationId: string;
}

export interface ProgressiveCooldownUnavailableResult {
  readonly status: "unavailable";
  /**
   * Omitted when the injected clock cannot provide a trustworthy absolute
   * timestamp. `retryAfterSeconds` remains safe for an HTTP Retry-After header.
   */
  readonly retryAtMs?: number;
  readonly retryAfterSeconds: number;
}

export interface ProgressiveCooldownAvailableResult {
  readonly status: "available";
  readonly streak: number;
}

export interface ProgressiveCooldownBlockedResult {
  readonly status: "control-capacity" | "cooldown" | "reservation-active";
  readonly availableAtMs: number;
  readonly retryAfterSeconds: number;
  readonly streak: number;
}

export type ProgressiveCooldownEligibilityResult =
  | ProgressiveCooldownAvailableResult
  | ProgressiveCooldownBlockedResult
  | ProgressiveCooldownUnavailableResult;

export interface ProgressiveCooldownReservedResult {
  readonly status: "reserved";
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly reservedAtMs: number;
  readonly leaseExpiresAtMs: number;
}

export interface ProgressiveCooldownPendingResult {
  readonly status: "pending-reconciliation";
  readonly reservationId: string;
  readonly leaseExpiredAtMs: number;
}

export interface ProgressiveCooldownReleasedResult {
  readonly status: "released";
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly releasedAtMs: number;
}

export interface ProgressiveCooldownCommittedResult {
  readonly status: "committed";
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly committedAtMs: number;
  readonly streak: number;
  readonly cooldownDurationMs: number;
  readonly cooldownUntilMs: number;
}

export interface ProgressiveCooldownAcceptanceMissingResult {
  readonly status: "acceptance-not-found";
}

export interface ProgressiveCooldownReservationMissingResult {
  readonly status: "reservation-not-found";
}

export interface ProgressiveCooldownReservationMismatchResult {
  readonly status: "reservation-mismatch";
}

export type ProgressiveCooldownReserveResult =
  | ProgressiveCooldownReservedResult
  | ProgressiveCooldownPendingResult
  | ProgressiveCooldownReleasedResult
  | ProgressiveCooldownCommittedResult
  | ProgressiveCooldownBlockedResult
  | ProgressiveCooldownUnavailableResult;

export type ProgressiveCooldownCommitResult =
  | ProgressiveCooldownCommittedResult
  | ProgressiveCooldownAcceptanceMissingResult
  | ProgressiveCooldownReservationMissingResult
  | ProgressiveCooldownReservationMismatchResult
  | ProgressiveCooldownUnavailableResult;

export type ProgressiveCooldownReleaseResult =
  | ProgressiveCooldownReleasedResult
  | ProgressiveCooldownCommittedResult
  | ProgressiveCooldownReservationMissingResult
  | ProgressiveCooldownReservationMismatchResult
  | ProgressiveCooldownUnavailableResult;

type MutableReservationRecord = {
  -readonly [Key in keyof ProgressiveCooldownReservationRecord]: ProgressiveCooldownReservationRecord[Key];
};

type ParsedCommittedReservationRecord = ProgressiveCooldownReservationRecord & {
  readonly status: "committed";
  readonly committedAtMs: number;
  readonly committedStreak: number;
  readonly cooldownDurationMs: number;
  readonly cooldownUntilMs: number;
};

type MutableState = {
  schemaVersion: "1";
  streak: number;
  lastCommittedAtMs?: number;
  cooldownUntilMs?: number;
  reservations: MutableReservationRecord[];
  hardDeleteByMs: number;
};

type Mutation<Result> = {
  readonly result: Result;
  readonly state?: MutableState;
};

const OPAQUE_SUBJECT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PURPOSE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){1,7}$/u;
const VERSION_PATTERN = /^v[1-9][0-9]{0,5}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;
const STATE_KEY_PATTERN = /^fbs1\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/u;
const RESERVATION_ID_PATTERN = /^fbr1\.([A-Za-z0-9_-]{21}[AQgw])$/u;
const REVISION_PATTERN = /^[\x20-\x7e]{1,256}$/u;

const SCOPE_KEYS = new Set(["purpose", "version", "opaqueSubjectKey"]);
const SNAPSHOT_KEYS = new Set(["revision", "state"]);
const REQUIRED_STATE_KEYS = new Set([
  "schemaVersion",
  "streak",
  "reservations",
  "hardDeleteByMs",
]);
const REQUIRED_RESERVATION_KEYS = new Set([
  "reservationId",
  "idempotencyDigest",
  "status",
  "reservedAtMs",
  "leaseExpiresAtMs",
  "reconciliationUntilMs",
]);
const STATE_KEYS = new Set([
  "schemaVersion",
  "streak",
  "lastCommittedAtMs",
  "cooldownUntilMs",
  "reservations",
  "hardDeleteByMs",
]);
const RESERVATION_KEYS = new Set([
  "reservationId",
  "idempotencyDigest",
  "status",
  "reservedAtMs",
  "leaseExpiresAtMs",
  "reconciliationUntilMs",
  "committedAtMs",
  "committedStreak",
  "cooldownDurationMs",
  "cooldownUntilMs",
  "releasedAtMs",
]);
const POLICY_KEYS = new Set([
  "cooldownLadderMs",
  "resetAfterMs",
  "reservationLeaseMs",
  "unavailableRetryAfterMs",
  "reconciliationRetentionMs",
  "maxReservationRecords",
  "maxRevisionConflicts",
  "operationTimeoutMs",
]);
const APPLIED_COMPARE_AND_SWAP_KEYS = new Set(["applied", "revision"]);
const CONFLICT_COMPARE_AND_SWAP_KEYS = new Set(["applied"]);

class OperationDeadline {
  readonly startedAtMs: number;
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
  readonly context: ProgressiveCooldownOperationContext;
  readonly #controller = new AbortController();
  readonly #timeout: ReturnType<typeof setTimeout>;
  readonly #externalSignal?: AbortSignal;
  readonly #externalAbortListener: () => void;

  constructor(
    nowMs: number,
    deadlineAtMs: number,
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
  ) {
    this.startedAtMs = nowMs;
    this.signal = this.#controller.signal;
    this.deadlineAtMs = deadlineAtMs;
    this.context = Object.freeze({
      signal: this.signal,
      deadlineAtMs: this.deadlineAtMs,
    });
    this.#externalSignal = externalSignal;
    this.#externalAbortListener = () => {
      this.#controller.abort();
    };
    if (externalSignal?.aborted) {
      this.#controller.abort();
    } else {
      externalSignal?.addEventListener("abort", this.#externalAbortListener, {
        once: true,
      });
    }

    this.#timeout = setTimeout(() => {
      this.#controller.abort();
    }, timeoutMs);
    this.#timeout.unref?.();
  }

  async wait<Value>(pending: Promise<Value>): Promise<Value> {
    return new Promise<Value>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        this.signal.removeEventListener("abort", abort);
        action();
      };
      const abort = () => {
        finish(() => {
          reject(new Error("Progressive cooldown operation unavailable."));
        });
      };

      if (this.signal.aborted) {
        abort();
      } else {
        this.signal.addEventListener("abort", abort, { once: true });
      }

      pending.then(
        (value) => {
          finish(() => {
            resolve(value);
          });
        },
        () => {
          finish(() => {
            reject(new Error("Progressive cooldown operation unavailable."));
          });
        },
      );
    });
  }

  dispose(): void {
    clearTimeout(this.#timeout);
    this.#externalSignal?.removeEventListener(
      "abort",
      this.#externalAbortListener,
    );
  }
}

function createOperationDeadline(
  nowMs: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): OperationDeadline | null {
  const deadlineAtMs = addTimestamp(nowMs, timeoutMs);
  return deadlineAtMs === null
    ? null
    : new OperationDeadline(nowMs, deadlineAtMs, timeoutMs, signal);
}

export class OpaqueProgressiveCooldownController {
  readonly #store: ProgressiveCooldownStore;
  readonly #acceptanceVerifier: ImmutableAcceptanceVerifier;
  readonly #clock: ProgressiveCooldownClock;
  readonly #reservationIdFactory: () => string;
  readonly #policy: ProgressiveCooldownPolicy;

  constructor(options: OpaqueProgressiveCooldownControllerOptions) {
    if (
      !options ||
      typeof options.store?.read !== "function" ||
      typeof options.store?.compareAndSwap !== "function" ||
      typeof options.acceptanceVerifier?.hasImmutableAcceptance !== "function"
    ) {
      throw new ProgressiveCooldownInputError("invalid-policy");
    }

    try {
      this.#policy = resolvePolicy(options.policy);
    } catch {
      throw new ProgressiveCooldownInputError("invalid-policy");
    }
    this.#store = options.store;
    this.#acceptanceVerifier = options.acceptanceVerifier;
    this.#clock = options.clock ?? { nowMs: () => Date.now() };
    this.#reservationIdFactory =
      options.reservationIdFactory ??
      (() => `fbr1.${randomBytes(16).toString("base64url")}`);
  }

  async getEligibility(
    command: ProgressiveCooldownScopeCommand,
  ): Promise<ProgressiveCooldownEligibilityResult> {
    const stateKey = deriveStateKey(validateScope(command?.scope));
    const nowMs = this.#getNow();
    if (nowMs === null) {
      return this.#unavailable(null);
    }

    const operation = createOperationDeadline(
      nowMs,
      this.#policy.operationTimeoutMs,
      command.signal,
    );
    if (!operation) {
      return this.#unavailable(null);
    }
    try {
      const snapshot = await this.#read(stateKey, operation);
      if (snapshot === "unavailable") {
        return this.#unavailable(nowMs);
      }

      const decisionNowMs = this.#getNow();
      if (decisionNowMs === null) {
        return this.#unavailable(null);
      }
      const state = snapshot
        ? normalizeState(snapshot.state, decisionNowMs, this.#policy)
        : createEmptyState(decisionNowMs);
      if (!state) {
        return this.#unavailable(decisionNowMs);
      }
      return eligibilityFor(state, decisionNowMs, this.#policy);
    } finally {
      operation.dispose();
    }
  }

  async reserve(
    command: ProgressiveCooldownReservationCommand,
  ): Promise<ProgressiveCooldownReserveResult> {
    const validatedScope = validateScope(command?.scope);
    const idempotencyKey = validateIdempotencyKey(command?.idempotencyKey);
    const stateKey = deriveStateKey(validatedScope);
    const idempotencyDigest = deriveIdempotencyDigest(stateKey, idempotencyKey);
    const nowMs = this.#getNow();
    if (nowMs === null) {
      return this.#unavailable(null);
    }

    let candidateReservationId: string | undefined;
    const getCandidateReservationId = (): string | null => {
      if (candidateReservationId) {
        return candidateReservationId;
      }
      try {
        const generated = this.#reservationIdFactory();
        if (
          typeof generated !== "string" ||
          !isCanonicalReservationId(generated)
        ) {
          return null;
        }
        candidateReservationId = generated;
        return generated;
      } catch {
        return null;
      }
    };

    const operation = createOperationDeadline(
      nowMs,
      this.#policy.operationTimeoutMs,
      command.signal,
    );
    if (!operation) {
      return this.#unavailable(null);
    }
    try {
      return await this.#mutate<ProgressiveCooldownReserveResult>(
        stateKey,
        nowMs,
        operation,
        (current, mutationNowMs) => {
          const state = normalizeState(current, mutationNowMs, this.#policy);
          if (!state) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          const replay = state.reservations.find(
            (record) => record.idempotencyDigest === idempotencyDigest,
          );
          if (replay) {
            return {
              result: reserveReplayResult(replay, mutationNowMs),
            };
          }

          const eligibility = eligibilityFor(
            state,
            mutationNowMs,
            this.#policy,
          );
          if (eligibility.status !== "available") {
            return { result: eligibility };
          }

          const reservationId = getCandidateReservationId();
          if (
            !reservationId ||
            state.reservations.some(
              (record) => record.reservationId === reservationId,
            )
          ) {
            return { result: this.#unavailable(mutationNowMs) };
          }

          const leaseExpiresAtMs = addTimestamp(
            mutationNowMs,
            this.#policy.reservationLeaseMs,
          );
          const reconciliationUntilMs =
            leaseExpiresAtMs === null
              ? null
              : addTimestamp(
                  leaseExpiresAtMs,
                  this.#policy.reconciliationRetentionMs,
                );
          if (leaseExpiresAtMs === null || reconciliationUntilMs === null) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          state.reservations.push({
            reservationId,
            idempotencyDigest,
            status: "reserved",
            reservedAtMs: mutationNowMs,
            leaseExpiresAtMs,
            reconciliationUntilMs,
          });
          const hardDeleteByMs = calculateHardDeleteBy(
            state,
            mutationNowMs,
            this.#policy,
          );
          if (hardDeleteByMs === null) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          state.hardDeleteByMs = hardDeleteByMs;

          return {
            state,
            result: {
              status: "reserved",
              replayed: false,
              reservationId,
              reservedAtMs: mutationNowMs,
              leaseExpiresAtMs,
            },
          };
        },
      );
    } finally {
      operation.dispose();
    }
  }

  async commitAccepted(
    command: ProgressiveCooldownTransitionCommand,
  ): Promise<ProgressiveCooldownCommitResult> {
    const validatedScope = validateScope(command?.scope);
    const idempotencyKey = validateIdempotencyKey(command?.idempotencyKey);
    const reservationId = validateReservationId(command?.reservationId);
    const stateKey = deriveStateKey(validatedScope);
    const idempotencyDigest = deriveIdempotencyDigest(stateKey, idempotencyKey);
    const nowMs = this.#getNow();
    if (nowMs === null) {
      return this.#unavailable(null);
    }

    const operation = createOperationDeadline(
      nowMs,
      this.#policy.operationTimeoutMs,
      command.signal,
    );
    if (!operation) {
      return this.#unavailable(null);
    }
    try {
      const existingSnapshot = await this.#read(stateKey, operation);
      if (existingSnapshot === "unavailable") {
        return this.#unavailable(nowMs);
      }
      if (existingSnapshot) {
        const decisionNowMs = this.#getNow();
        if (decisionNowMs === null) {
          return this.#unavailable(null);
        }
        const existingState = normalizeState(
          existingSnapshot.state,
          decisionNowMs,
          this.#policy,
        );
        if (!existingState) {
          return this.#unavailable(decisionNowMs);
        }
        const existingRecord = existingState.reservations.find(
          (candidate) => candidate.reservationId === reservationId,
        );
        if (!existingRecord) {
          return { status: "reservation-not-found" };
        }
        if (existingRecord.idempotencyDigest !== idempotencyDigest) {
          return { status: "reservation-mismatch" };
        }
        if (existingRecord.status === "committed") {
          return committedResult(existingRecord, true);
        }
      } else {
        return { status: "reservation-not-found" };
      }

      let accepted: boolean;
      try {
        if (operation.signal.aborted) {
          return this.#unavailable(nowMs);
        }
        accepted =
          (await operation.wait(
            this.#acceptanceVerifier.hasImmutableAcceptance({
              stateKey,
              reservationId,
              signal: operation.signal,
              deadlineAtMs: operation.deadlineAtMs,
            }),
          )) === true;
      } catch {
        return this.#unavailable(nowMs);
      }
      if (!accepted) {
        return { status: "acceptance-not-found" };
      }

      return await this.#mutate<ProgressiveCooldownCommitResult>(
        stateKey,
        nowMs,
        operation,
        (current, mutationNowMs) => {
          const state = normalizeState(current, mutationNowMs, this.#policy);
          if (!state) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          const record = state.reservations.find(
            (candidate) => candidate.reservationId === reservationId,
          );
          if (!record) {
            return { result: { status: "reservation-not-found" } };
          }
          if (record.idempotencyDigest !== idempotencyDigest) {
            return { result: { status: "reservation-mismatch" } };
          }
          if (record.status === "committed") {
            return { result: committedResult(record, true) };
          }

          const nextStreak = Math.min(
            state.streak + 1,
            this.#policy.cooldownLadderMs.length,
          );
          const cooldownDurationMs =
            this.#policy.cooldownLadderMs[nextStreak - 1];
          if (cooldownDurationMs === undefined) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          const cooldownUntilMs = addTimestamp(
            mutationNowMs,
            cooldownDurationMs,
          );
          const quietResetAtMs = addTimestamp(
            mutationNowMs,
            this.#policy.resetAfterMs,
          );
          const reconciliationUntilMs =
            quietResetAtMs === null
              ? null
              : addTimestamp(
                  quietResetAtMs,
                  this.#policy.reconciliationRetentionMs,
                );
          if (
            cooldownUntilMs === null ||
            quietResetAtMs === null ||
            reconciliationUntilMs === null ||
            (state.lastCommittedAtMs !== undefined &&
              mutationNowMs < state.lastCommittedAtMs)
          ) {
            return { result: this.#unavailable(mutationNowMs) };
          }

          record.status = "committed";
          record.committedAtMs = mutationNowMs;
          record.committedStreak = nextStreak;
          record.cooldownDurationMs = cooldownDurationMs;
          record.cooldownUntilMs = cooldownUntilMs;
          record.reconciliationUntilMs = reconciliationUntilMs;
          delete record.releasedAtMs;
          state.streak = nextStreak;
          state.lastCommittedAtMs = mutationNowMs;
          state.cooldownUntilMs = cooldownUntilMs;
          const hardDeleteByMs = calculateHardDeleteBy(
            state,
            mutationNowMs,
            this.#policy,
          );
          if (hardDeleteByMs === null) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          state.hardDeleteByMs = hardDeleteByMs;

          return {
            state,
            result: committedResult(record, false),
          };
        },
      );
    } finally {
      operation.dispose();
    }
  }

  async release(
    command: ProgressiveCooldownTransitionCommand,
  ): Promise<ProgressiveCooldownReleaseResult> {
    const validatedScope = validateScope(command?.scope);
    const idempotencyKey = validateIdempotencyKey(command?.idempotencyKey);
    const reservationId = validateReservationId(command?.reservationId);
    const stateKey = deriveStateKey(validatedScope);
    const idempotencyDigest = deriveIdempotencyDigest(stateKey, idempotencyKey);
    const nowMs = this.#getNow();
    if (nowMs === null) {
      return this.#unavailable(null);
    }

    const operation = createOperationDeadline(
      nowMs,
      this.#policy.operationTimeoutMs,
      command.signal,
    );
    if (!operation) {
      return this.#unavailable(null);
    }
    try {
      return await this.#mutate<ProgressiveCooldownReleaseResult>(
        stateKey,
        nowMs,
        operation,
        (current, mutationNowMs) => {
          const state = normalizeState(current, mutationNowMs, this.#policy);
          if (!state) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          const record = state.reservations.find(
            (candidate) => candidate.reservationId === reservationId,
          );
          if (!record) {
            return { result: { status: "reservation-not-found" } };
          }
          if (record.idempotencyDigest !== idempotencyDigest) {
            return { result: { status: "reservation-mismatch" } };
          }
          if (record.status === "committed") {
            return { result: committedResult(record, true) };
          }
          if (record.status === "released") {
            return { result: releasedResult(record, true) };
          }

          record.status = "released";
          record.releasedAtMs = mutationNowMs;
          const reconciliationUntilMs = addTimestamp(
            mutationNowMs,
            this.#policy.reconciliationRetentionMs,
          );
          if (reconciliationUntilMs === null) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          record.reconciliationUntilMs = reconciliationUntilMs;
          const hardDeleteByMs = calculateHardDeleteBy(
            state,
            mutationNowMs,
            this.#policy,
          );
          if (hardDeleteByMs === null) {
            return { result: this.#unavailable(mutationNowMs) };
          }
          state.hardDeleteByMs = hardDeleteByMs;

          return {
            state,
            result: releasedResult(record, false),
          };
        },
      );
    } finally {
      operation.dispose();
    }
  }

  #getNow(): number | null {
    try {
      const nowMs = this.#clock.nowMs();
      return isTimestamp(nowMs) && canUseClock(nowMs, this.#policy)
        ? nowMs
        : null;
    } catch {
      return null;
    }
  }

  #unavailable(nowMs: number | null): ProgressiveCooldownUnavailableResult {
    const retryAtMs =
      nowMs === null
        ? null
        : addTimestamp(nowMs, this.#policy.unavailableRetryAfterMs);
    return {
      status: "unavailable",
      ...(retryAtMs === null ? {} : { retryAtMs }),
      retryAfterSeconds:
        retryAtMs === null || nowMs === null
          ? Math.ceil(this.#policy.unavailableRetryAfterMs / SECOND_MS)
          : retryAfterSeconds(retryAtMs, nowMs),
    };
  }

  async #read(
    stateKey: string,
    operation: OperationDeadline,
  ): Promise<ProgressiveCooldownSnapshot | null | "unavailable"> {
    try {
      if (operation.signal.aborted) {
        return "unavailable";
      }
      const snapshot = await operation.wait(
        this.#store.read(stateKey, operation.context),
      );
      if (snapshot === null) {
        return null;
      }
      const validationNowMs = this.#getNow();
      if (validationNowMs === null) {
        return "unavailable";
      }
      return (
        parseSnapshot(snapshot, this.#policy, validationNowMs) ?? "unavailable"
      );
    } catch {
      return "unavailable";
    }
  }

  async #mutate<Result>(
    stateKey: string,
    nowMs: number,
    operation: OperationDeadline,
    reducer: (state: MutableState, mutationNowMs: number) => Mutation<Result>,
  ): Promise<Result | ProgressiveCooldownUnavailableResult> {
    for (
      let attempt = 0;
      attempt < this.#policy.maxRevisionConflicts;
      attempt += 1
    ) {
      const snapshot = await this.#read(stateKey, operation);
      if (snapshot === "unavailable") {
        return this.#unavailable(nowMs);
      }
      const mutationNowMs = this.#getNow();
      if (mutationNowMs === null) {
        return this.#unavailable(null);
      }
      const initialState = snapshot
        ? mutableState(snapshot.state)
        : createEmptyState(mutationNowMs);
      let mutation: Mutation<Result>;
      try {
        mutation = reducer(initialState, mutationNowMs);
      } catch {
        return this.#unavailable(mutationNowMs);
      }
      if (!mutation.state) {
        return mutation.result;
      }

      try {
        if (operation.signal.aborted) {
          return this.#unavailable(nowMs);
        }
        const nextState = immutableState(mutation.state);
        if (!parseState(nextState, this.#policy, mutationNowMs)) {
          return this.#unavailable(mutationNowMs);
        }
        const applied = await operation.wait(
          this.#store.compareAndSwap(
            {
              stateKey,
              expectedRevision: snapshot?.revision ?? null,
              state: nextState,
            },
            operation.context,
          ),
        );
        if (!isCompareAndSwapResult(applied)) {
          return this.#unavailable(mutationNowMs);
        }
        if (applied.applied) {
          if (snapshot !== null && applied.revision === snapshot.revision) {
            return this.#unavailable(mutationNowMs);
          }
          return mutation.result;
        }
      } catch {
        return this.#unavailable(mutationNowMs);
      }
    }

    return this.#unavailable(nowMs);
  }
}

function validateScope(
  scope: ProgressiveCooldownScope,
): ProgressiveCooldownScope {
  let purpose: unknown;
  let version: unknown;
  let opaqueSubjectKey: unknown;
  try {
    if (
      !isPlainObject(scope) ||
      !hasOnlyKeys(scope, SCOPE_KEYS) ||
      !hasOwnKeys(scope, SCOPE_KEYS)
    ) {
      throw new ProgressiveCooldownInputError("invalid-opaque-subject");
    }
    purpose = scope.purpose;
    version = scope.version;
    opaqueSubjectKey = scope.opaqueSubjectKey;
  } catch {
    throw new ProgressiveCooldownInputError("invalid-opaque-subject");
  }
  if (
    typeof purpose !== "string" ||
    purpose.length > 64 ||
    !PURPOSE_PATTERN.test(purpose)
  ) {
    throw new ProgressiveCooldownInputError("invalid-purpose");
  }
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new ProgressiveCooldownInputError("invalid-version");
  }
  if (
    typeof opaqueSubjectKey !== "string" ||
    !isCanonicalBase64Url32(opaqueSubjectKey)
  ) {
    throw new ProgressiveCooldownInputError("invalid-opaque-subject");
  }
  return {
    purpose,
    version,
    opaqueSubjectKey,
  };
}

function validateIdempotencyKey(value: string): string {
  if (typeof value !== "string" || !IDEMPOTENCY_PATTERN.test(value)) {
    throw new ProgressiveCooldownInputError("invalid-idempotency-key");
  }
  return value;
}

function validateReservationId(value: string): string {
  if (typeof value !== "string" || !isCanonicalReservationId(value)) {
    throw new ProgressiveCooldownInputError("invalid-reservation-id");
  }
  return value;
}

function isCanonicalBase64Url32(value: string): boolean {
  if (!OPAQUE_SUBJECT_PATTERN.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.byteLength === 32 && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
}

function isCanonicalReservationId(value: string): boolean {
  const match = RESERVATION_ID_PATTERN.exec(value);
  if (!match?.[1]) {
    return false;
  }
  try {
    const decoded = Buffer.from(match[1], "base64url");
    return (
      decoded.byteLength === 16 && decoded.toString("base64url") === match[1]
    );
  } catch {
    return false;
  }
}

function isCanonicalStateKey(value: string): boolean {
  const match = STATE_KEY_PATTERN.exec(value);
  if (!match?.[1]) {
    return false;
  }
  try {
    const decoded = Buffer.from(match[1], "base64url");
    return (
      decoded.byteLength === 32 && decoded.toString("base64url") === match[1]
    );
  } catch {
    return false;
  }
}

function deriveStateKey(scope: ProgressiveCooldownScope): string {
  const digest = createHash("sha256")
    .update("opaque-progressive-cooldown:v1", "utf8")
    .update("\0", "utf8")
    .update(scope.version, "utf8")
    .update("\0", "utf8")
    .update(scope.purpose, "utf8")
    .update("\0", "utf8")
    .update(scope.opaqueSubjectKey, "utf8")
    .digest("base64url");
  const stateKey = `fbs1.${digest}`;
  if (!isCanonicalStateKey(stateKey)) {
    throw new Error("Progressive cooldown state-key derivation failed.");
  }
  return stateKey;
}

function deriveIdempotencyDigest(
  stateKey: string,
  idempotencyKey: string,
): string {
  return createHash("sha256")
    .update("opaque-progressive-cooldown-idempotency:v1", "utf8")
    .update("\0", "utf8")
    .update(stateKey, "utf8")
    .update("\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("base64url");
}

function resolvePolicy(
  override: Partial<ProgressiveCooldownPolicy> | undefined,
): ProgressiveCooldownPolicy {
  if (
    override !== undefined &&
    (!isPlainObject(override) || !hasOnlyKeys(override, POLICY_KEYS))
  ) {
    throw new ProgressiveCooldownInputError("invalid-policy");
  }
  const candidate: ProgressiveCooldownPolicy = {
    ...DEFAULT_PROGRESSIVE_COOLDOWN_POLICY,
    ...override,
    cooldownLadderMs:
      override?.cooldownLadderMs ??
      DEFAULT_PROGRESSIVE_COOLDOWN_POLICY.cooldownLadderMs,
  };
  const ladder = [...candidate.cooldownLadderMs];

  if (
    ladder.length < 1 ||
    ladder.length > 16 ||
    ladder.some(
      (duration, index) =>
        !isDuration(duration, SECOND_MS, MAX_PROGRESSIVE_COOLDOWN_MS) ||
        (index > 0 && duration < (ladder[index - 1] ?? 0)),
    ) ||
    !isDuration(
      candidate.resetAfterMs,
      ladder[ladder.length - 1] ?? SECOND_MS,
      30 * DAY_MS,
    ) ||
    !isDuration(candidate.reservationLeaseMs, SECOND_MS, 15 * MINUTE_MS) ||
    !isDuration(candidate.unavailableRetryAfterMs, SECOND_MS, 5 * MINUTE_MS) ||
    !isDuration(candidate.reconciliationRetentionMs, MINUTE_MS, 6 * DAY_MS) ||
    !isBoundedInteger(candidate.maxReservationRecords, 1, 256) ||
    !isBoundedInteger(candidate.maxRevisionConflicts, 1, 20) ||
    !isDuration(candidate.operationTimeoutMs, 10, 30 * SECOND_MS)
  ) {
    throw new ProgressiveCooldownInputError("invalid-policy");
  }

  return Object.freeze({
    ...candidate,
    cooldownLadderMs: Object.freeze(ladder),
  });
}

function isDuration(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function addTimestamp(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function canUseClock(
  nowMs: number,
  policy: ProgressiveCooldownPolicy,
): boolean {
  const maximumHorizonMs = Math.max(
    policy.operationTimeoutMs,
    policy.unavailableRetryAfterMs,
    policy.reservationLeaseMs +
      policy.reconciliationRetentionMs +
      PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS,
    policy.resetAfterMs +
      policy.reconciliationRetentionMs +
      PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS,
  );
  return addTimestamp(nowMs, maximumHorizonMs) !== null;
}

function retryAfterSeconds(availableAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((availableAtMs - nowMs) / SECOND_MS));
}

function createEmptyState(nowMs: number): MutableState {
  return {
    schemaVersion: "1",
    streak: 0,
    reservations: [],
    hardDeleteByMs: nowMs,
  };
}

function mutableState(state: ProgressiveCooldownState): MutableState {
  return {
    schemaVersion: "1",
    streak: state.streak,
    ...(state.lastCommittedAtMs === undefined
      ? {}
      : { lastCommittedAtMs: state.lastCommittedAtMs }),
    ...(state.cooldownUntilMs === undefined
      ? {}
      : { cooldownUntilMs: state.cooldownUntilMs }),
    reservations: state.reservations.map((record) => ({ ...record })),
    hardDeleteByMs: state.hardDeleteByMs,
  };
}

function immutableState(state: MutableState): ProgressiveCooldownState {
  const reservations = Object.freeze(
    state.reservations.map((record) => Object.freeze({ ...record })),
  );
  return Object.freeze({
    schemaVersion: "1",
    streak: state.streak,
    ...(state.lastCommittedAtMs === undefined
      ? {}
      : { lastCommittedAtMs: state.lastCommittedAtMs }),
    ...(state.cooldownUntilMs === undefined
      ? {}
      : { cooldownUntilMs: state.cooldownUntilMs }),
    reservations,
    hardDeleteByMs: state.hardDeleteByMs,
  });
}

function normalizeState(
  source: ProgressiveCooldownState | MutableState,
  nowMs: number,
  policy: ProgressiveCooldownPolicy,
): MutableState | null {
  const state = mutableState(source);
  if (
    (state.lastCommittedAtMs !== undefined &&
      state.lastCommittedAtMs > nowMs) ||
    state.reservations.some(
      (record) =>
        record.reservedAtMs > nowMs ||
        (record.committedAtMs !== undefined && record.committedAtMs > nowMs) ||
        (record.releasedAtMs !== undefined && record.releasedAtMs > nowMs),
    )
  ) {
    return null;
  }
  state.reservations = state.reservations.filter(
    (record) => record.reconciliationUntilMs > nowMs,
  );

  if (
    state.lastCommittedAtMs !== undefined &&
    nowMs - state.lastCommittedAtMs >= policy.resetAfterMs
  ) {
    state.streak = 0;
    delete state.lastCommittedAtMs;
    delete state.cooldownUntilMs;
  }

  const hardDeleteByMs = calculateHardDeleteBy(state, nowMs, policy);
  if (hardDeleteByMs === null) {
    return null;
  }
  state.hardDeleteByMs = hardDeleteByMs;
  return state;
}

function calculateHardDeleteBy(
  state: MutableState,
  nowMs: number,
  policy: ProgressiveCooldownPolicy,
): number | null {
  let reconciliationHorizonMs = nowMs;
  for (const record of state.reservations) {
    reconciliationHorizonMs = Math.max(
      reconciliationHorizonMs,
      record.reconciliationUntilMs,
    );
  }
  if (state.lastCommittedAtMs !== undefined) {
    const quietResetAtMs = addTimestamp(
      state.lastCommittedAtMs,
      policy.resetAfterMs,
    );
    const reconciliationUntilMs =
      quietResetAtMs === null
        ? null
        : addTimestamp(quietResetAtMs, policy.reconciliationRetentionMs);
    if (reconciliationUntilMs === null) {
      return null;
    }
    reconciliationHorizonMs = Math.max(
      reconciliationHorizonMs,
      reconciliationUntilMs,
    );
  }
  if (state.cooldownUntilMs !== undefined) {
    const reconciliationUntilMs = addTimestamp(
      state.cooldownUntilMs,
      policy.reconciliationRetentionMs,
    );
    if (reconciliationUntilMs === null) {
      return null;
    }
    reconciliationHorizonMs = Math.max(
      reconciliationHorizonMs,
      reconciliationUntilMs,
    );
  }
  return addTimestamp(
    reconciliationHorizonMs,
    PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS,
  );
}

function calculatePersistedHardDeleteBy(
  state: MutableState,
  policy: ProgressiveCooldownPolicy,
): number | null {
  let reconciliationHorizonMs = state.reservations.reduce(
    (maximum, record) => Math.max(maximum, record.reconciliationUntilMs),
    0,
  );
  if (state.lastCommittedAtMs !== undefined) {
    const quietResetAtMs = addTimestamp(
      state.lastCommittedAtMs,
      policy.resetAfterMs,
    );
    const reconciliationUntilMs =
      quietResetAtMs === null
        ? null
        : addTimestamp(quietResetAtMs, policy.reconciliationRetentionMs);
    if (reconciliationUntilMs === null) {
      return null;
    }
    reconciliationHorizonMs = Math.max(
      reconciliationHorizonMs,
      reconciliationUntilMs,
    );
  }
  if (state.cooldownUntilMs !== undefined) {
    const reconciliationUntilMs = addTimestamp(
      state.cooldownUntilMs,
      policy.reconciliationRetentionMs,
    );
    if (reconciliationUntilMs === null) {
      return null;
    }
    reconciliationHorizonMs = Math.max(
      reconciliationHorizonMs,
      reconciliationUntilMs,
    );
  }
  return addTimestamp(
    reconciliationHorizonMs,
    PROGRESSIVE_COOLDOWN_PURGE_SAFETY_MS,
  );
}

function eligibilityFor(
  state: MutableState,
  nowMs: number,
  policy: ProgressiveCooldownPolicy,
): ProgressiveCooldownAvailableResult | ProgressiveCooldownBlockedResult {
  if (state.cooldownUntilMs !== undefined && state.cooldownUntilMs > nowMs) {
    return {
      status: "cooldown",
      availableAtMs: state.cooldownUntilMs,
      retryAfterSeconds: retryAfterSeconds(state.cooldownUntilMs, nowMs),
      streak: state.streak,
    };
  }

  const activeLeaseEnds = state.reservations
    .filter(
      (record) =>
        record.status === "reserved" && record.leaseExpiresAtMs > nowMs,
    )
    .map((record) => record.leaseExpiresAtMs);
  if (activeLeaseEnds.length > 0) {
    const availableAtMs = Math.max(...activeLeaseEnds);
    return {
      status: "reservation-active",
      availableAtMs,
      retryAfterSeconds: retryAfterSeconds(availableAtMs, nowMs),
      streak: state.streak,
    };
  }

  if (state.reservations.length >= policy.maxReservationRecords) {
    const availableAtMs = Math.min(
      ...state.reservations.map((record) => record.reconciliationUntilMs),
    );
    return {
      status: "control-capacity",
      availableAtMs,
      retryAfterSeconds: retryAfterSeconds(availableAtMs, nowMs),
      streak: state.streak,
    };
  }

  return { status: "available", streak: state.streak };
}

function reserveReplayResult(
  record: MutableReservationRecord,
  nowMs: number,
):
  | ProgressiveCooldownReservedResult
  | ProgressiveCooldownPendingResult
  | ProgressiveCooldownReleasedResult
  | ProgressiveCooldownCommittedResult {
  if (record.status === "committed") {
    return committedResult(record, true);
  }
  if (record.status === "released") {
    return releasedResult(record, true);
  }
  if (record.leaseExpiresAtMs <= nowMs) {
    return {
      status: "pending-reconciliation",
      reservationId: record.reservationId,
      leaseExpiredAtMs: record.leaseExpiresAtMs,
    };
  }
  return {
    status: "reserved",
    replayed: true,
    reservationId: record.reservationId,
    reservedAtMs: record.reservedAtMs,
    leaseExpiresAtMs: record.leaseExpiresAtMs,
  };
}

function committedResult(
  record: MutableReservationRecord,
  replayed: boolean,
): ProgressiveCooldownCommittedResult {
  if (
    record.status !== "committed" ||
    record.committedAtMs === undefined ||
    record.committedStreak === undefined ||
    record.cooldownDurationMs === undefined ||
    record.cooldownUntilMs === undefined
  ) {
    throw new Error("Invalid internal progressive cooldown state.");
  }
  return {
    status: "committed",
    replayed,
    reservationId: record.reservationId,
    committedAtMs: record.committedAtMs,
    streak: record.committedStreak,
    cooldownDurationMs: record.cooldownDurationMs,
    cooldownUntilMs: record.cooldownUntilMs,
  };
}

function releasedResult(
  record: MutableReservationRecord,
  replayed: boolean,
): ProgressiveCooldownReleasedResult {
  if (record.status !== "released" || record.releasedAtMs === undefined) {
    throw new Error("Invalid internal progressive cooldown state.");
  }
  return {
    status: "released",
    replayed,
    reservationId: record.reservationId,
    releasedAtMs: record.releasedAtMs,
  };
}

function parseSnapshot(
  input: unknown,
  policy: ProgressiveCooldownPolicy,
  nowMs: number,
): ProgressiveCooldownSnapshot | null {
  if (
    !isPlainObject(input) ||
    !hasOnlyKeys(input, SNAPSHOT_KEYS) ||
    !hasOwnKeys(input, SNAPSHOT_KEYS)
  ) {
    return null;
  }
  const revision = input.revision;
  if (typeof revision !== "string" || !REVISION_PATTERN.test(revision)) {
    return null;
  }
  const state = parseState(input.state, policy, nowMs);
  return state ? { revision, state } : null;
}

function parseState(
  input: unknown,
  policy: ProgressiveCooldownPolicy,
  nowMs: number,
): ProgressiveCooldownState | null {
  if (
    !isPlainObject(input) ||
    !hasOnlyKeys(input, STATE_KEYS) ||
    !hasOwnKeys(input, REQUIRED_STATE_KEYS)
  ) {
    return null;
  }
  if (
    input.schemaVersion !== "1" ||
    !isBoundedInteger(
      input.streak as number,
      0,
      policy.cooldownLadderMs.length,
    ) ||
    !isTimestamp(input.hardDeleteByMs) ||
    !Array.isArray(input.reservations) ||
    input.reservations.length > policy.maxReservationRecords
  ) {
    return null;
  }

  const reservations: ProgressiveCooldownReservationRecord[] = [];
  const reservationIds = new Set<string>();
  const idempotencyDigests = new Set<string>();
  for (const candidate of input.reservations) {
    const parsed = parseReservation(candidate, policy, nowMs);
    if (
      !parsed ||
      reservationIds.has(parsed.reservationId) ||
      idempotencyDigests.has(parsed.idempotencyDigest)
    ) {
      return null;
    }
    reservationIds.add(parsed.reservationId);
    idempotencyDigests.add(parsed.idempotencyDigest);
    reservations.push(parsed);
  }

  const lastCommittedAtMs =
    input.lastCommittedAtMs === undefined
      ? undefined
      : isTimestamp(input.lastCommittedAtMs)
        ? input.lastCommittedAtMs
        : null;
  const cooldownUntilMs =
    input.cooldownUntilMs === undefined
      ? undefined
      : isTimestamp(input.cooldownUntilMs)
        ? input.cooldownUntilMs
        : null;
  if (lastCommittedAtMs === null || cooldownUntilMs === null) {
    return null;
  }
  const streak = input.streak as number;
  if (
    (streak === 0 &&
      (lastCommittedAtMs !== undefined || cooldownUntilMs !== undefined)) ||
    (streak > 0 &&
      (lastCommittedAtMs === undefined ||
        cooldownUntilMs === undefined ||
        cooldownUntilMs < lastCommittedAtMs)) ||
    (lastCommittedAtMs !== undefined && lastCommittedAtMs > nowMs)
  ) {
    return null;
  }

  const expectedHardDeleteByMs = calculatePersistedHardDeleteBy(
    {
      schemaVersion: "1",
      streak,
      ...(lastCommittedAtMs === undefined ? {} : { lastCommittedAtMs }),
      ...(cooldownUntilMs === undefined ? {} : { cooldownUntilMs }),
      reservations: reservations.map((record) => ({ ...record })),
      hardDeleteByMs: input.hardDeleteByMs,
    },
    policy,
  );
  if (
    expectedHardDeleteByMs === null ||
    (reservations.length === 0
      ? input.hardDeleteByMs > nowMs
      : input.hardDeleteByMs !== expectedHardDeleteByMs)
  ) {
    return null;
  }
  const latestCommittedRecord = validateCommittedHistory(reservations, policy);
  if (latestCommittedRecord === "invalid") {
    return null;
  }
  if (streak > 0) {
    if (lastCommittedAtMs === undefined) {
      return null;
    }
    if (
      !latestCommittedRecord ||
      latestCommittedRecord.committedAtMs !== lastCommittedAtMs ||
      latestCommittedRecord.committedStreak !== streak ||
      latestCommittedRecord.cooldownUntilMs !== cooldownUntilMs
    ) {
      return null;
    }
  }

  return {
    schemaVersion: "1",
    streak,
    ...(lastCommittedAtMs === undefined ? {} : { lastCommittedAtMs }),
    ...(cooldownUntilMs === undefined ? {} : { cooldownUntilMs }),
    reservations,
    hardDeleteByMs: input.hardDeleteByMs,
  };
}

function validateCommittedHistory(
  reservations: readonly ProgressiveCooldownReservationRecord[],
  policy: ProgressiveCooldownPolicy,
): ParsedCommittedReservationRecord | null | "invalid" {
  const committed = reservations
    .filter(
      (record): record is ParsedCommittedReservationRecord =>
        record.status === "committed" &&
        record.committedAtMs !== undefined &&
        record.committedStreak !== undefined &&
        record.cooldownDurationMs !== undefined &&
        record.cooldownUntilMs !== undefined,
    )
    .sort(
      (left, right) =>
        left.committedAtMs - right.committedAtMs ||
        left.committedStreak - right.committedStreak ||
        left.reservationId.localeCompare(right.reservationId),
    );
  if (committed.length === 0) {
    return null;
  }

  let previous = committed[0];
  if (!previous) {
    return "invalid";
  }
  for (const record of committed.slice(1)) {
    const expectedStreak =
      record.committedAtMs - previous.committedAtMs >= policy.resetAfterMs
        ? 1
        : Math.min(
            previous.committedStreak + 1,
            policy.cooldownLadderMs.length,
          );
    if (record.committedStreak !== expectedStreak) {
      return "invalid";
    }
    previous = record;
  }
  return previous;
}

function parseReservation(
  input: unknown,
  policy: ProgressiveCooldownPolicy,
  nowMs: number,
): ProgressiveCooldownReservationRecord | null {
  if (
    !isPlainObject(input) ||
    !hasOnlyKeys(input, RESERVATION_KEYS) ||
    !hasOwnKeys(input, REQUIRED_RESERVATION_KEYS)
  ) {
    return null;
  }
  const expectedLeaseExpiresAtMs = isTimestamp(input.reservedAtMs)
    ? addTimestamp(input.reservedAtMs, policy.reservationLeaseMs)
    : null;
  if (
    typeof input.reservationId !== "string" ||
    !isCanonicalReservationId(input.reservationId) ||
    typeof input.idempotencyDigest !== "string" ||
    !isCanonicalBase64Url32(input.idempotencyDigest) ||
    !isTimestamp(input.reservedAtMs) ||
    input.reservedAtMs > nowMs ||
    !isTimestamp(input.leaseExpiresAtMs) ||
    expectedLeaseExpiresAtMs === null ||
    input.leaseExpiresAtMs !== expectedLeaseExpiresAtMs ||
    !isTimestamp(input.reconciliationUntilMs) ||
    input.reconciliationUntilMs < input.reservedAtMs
  ) {
    return null;
  }

  const common = {
    reservationId: input.reservationId,
    idempotencyDigest: input.idempotencyDigest,
    reservedAtMs: input.reservedAtMs,
    leaseExpiresAtMs: input.leaseExpiresAtMs,
    reconciliationUntilMs: input.reconciliationUntilMs,
  };

  if (input.status === "reserved") {
    const expectedRetainUntilMs = addTimestamp(
      input.leaseExpiresAtMs,
      policy.reconciliationRetentionMs,
    );
    if (
      expectedRetainUntilMs === null ||
      input.reconciliationUntilMs !== expectedRetainUntilMs ||
      input.committedAtMs !== undefined ||
      input.committedStreak !== undefined ||
      input.cooldownDurationMs !== undefined ||
      input.cooldownUntilMs !== undefined ||
      input.releasedAtMs !== undefined
    ) {
      return null;
    }
    return { ...common, status: "reserved" };
  }

  if (input.status === "released") {
    const expectedRetainUntilMs = isTimestamp(input.releasedAtMs)
      ? addTimestamp(input.releasedAtMs, policy.reconciliationRetentionMs)
      : null;
    if (
      !isTimestamp(input.releasedAtMs) ||
      input.releasedAtMs < input.reservedAtMs ||
      input.releasedAtMs > nowMs ||
      expectedRetainUntilMs === null ||
      input.reconciliationUntilMs !== expectedRetainUntilMs ||
      input.committedAtMs !== undefined ||
      input.committedStreak !== undefined ||
      input.cooldownDurationMs !== undefined ||
      input.cooldownUntilMs !== undefined
    ) {
      return null;
    }
    return {
      ...common,
      status: "released",
      releasedAtMs: input.releasedAtMs,
    };
  }

  if (input.status === "committed") {
    const quietResetAtMs = isTimestamp(input.committedAtMs)
      ? addTimestamp(input.committedAtMs, policy.resetAfterMs)
      : null;
    const expectedRetainUntilMs =
      quietResetAtMs === null
        ? null
        : addTimestamp(quietResetAtMs, policy.reconciliationRetentionMs);
    if (
      !isTimestamp(input.committedAtMs) ||
      input.committedAtMs < input.reservedAtMs ||
      input.committedAtMs > nowMs ||
      !isBoundedInteger(
        input.committedStreak as number,
        1,
        policy.cooldownLadderMs.length,
      ) ||
      !isTimestamp(input.cooldownDurationMs) ||
      input.cooldownDurationMs !==
        policy.cooldownLadderMs[(input.committedStreak as number) - 1] ||
      !isTimestamp(input.cooldownUntilMs) ||
      input.cooldownUntilMs !==
        addTimestamp(input.committedAtMs, input.cooldownDurationMs) ||
      expectedRetainUntilMs === null ||
      input.reconciliationUntilMs !== expectedRetainUntilMs ||
      input.releasedAtMs !== undefined
    ) {
      return null;
    }
    return {
      ...common,
      status: "committed",
      committedAtMs: input.committedAtMs,
      committedStreak: input.committedStreak as number,
      cooldownDurationMs: input.cooldownDurationMs,
      cooldownUntilMs: input.cooldownUntilMs,
    };
  }

  return null;
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  input: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(input).every((key) => allowedKeys.has(key));
}

function hasOwnKeys(
  input: Record<string, unknown>,
  requiredKeys: ReadonlySet<string>,
): boolean {
  return [...requiredKeys].every((key) =>
    Object.prototype.hasOwnProperty.call(input, key),
  );
}

function isCompareAndSwapResult(
  input: unknown,
): input is
  | { readonly applied: true; readonly revision: string }
  | { readonly applied: false } {
  if (!isPlainObject(input) || typeof input.applied !== "boolean") {
    return false;
  }
  if (!input.applied) {
    return (
      hasOnlyKeys(input, CONFLICT_COMPARE_AND_SWAP_KEYS) &&
      hasOwnKeys(input, CONFLICT_COMPARE_AND_SWAP_KEYS)
    );
  }
  return (
    hasOnlyKeys(input, APPLIED_COMPARE_AND_SWAP_KEYS) &&
    hasOwnKeys(input, APPLIED_COMPARE_AND_SWAP_KEYS) &&
    typeof input.revision === "string" &&
    REVISION_PATTERN.test(input.revision)
  );
}
