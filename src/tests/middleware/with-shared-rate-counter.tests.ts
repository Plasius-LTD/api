import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  withRateLimiting,
  type SharedRateLimitCounter,
  type SharedRateLimitCounterResult,
} from "../../middleware/withRateLimiting.js";

const windowMs = 60_000;
const windowStart = 1_800_000_000_000;
const principal = "verified-actor-canary";
const request = {
  method: "POST",
  url: "https://example.test/route/path-canary?cursor=cursor-canary",
  headers: new Headers({
    Authorization: "Bearer credential-canary",
    "X-Forwarded-For": "192.0.2.12",
  }),
} as unknown as HttpRequest;

function invocation(user?: { userId: string }) {
  const warn = vi.fn();
  const context = {
    extraInputs: new Map<string, unknown>([["logger", { warn }], ["user", user]]),
    extraOutputs: new Map<string, unknown>(),
  } as unknown as InvocationContext;
  return {
    context,
    warn,
    response: () => context.extraOutputs.get("http") as HttpResponseInit | undefined,
  };
}

function clock() {
  vi.useFakeTimers();
  vi.setSystemTime(windowStart + 500);
  vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "unit-test-shared-counter-key");
}

function setup(store: SharedRateLimitCounter) {
  return { store, namespace: "request-review", routeKey: "review-detail" } as const;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("opt-in shared request counter", () => {
  it("uses one shared opaque window key across replicas, expiring at the absolute boundary", async () => {
    clock();
    const counts = new Map<string, number>();
    const consume = vi.fn<SharedRateLimitCounter["consume"]>(async ({ bucket, limit }) => {
      const count = counts.get(bucket) ?? 0;
      if (count >= limit) return { status: "exhausted" };
      counts.set(bucket, count + 1);
      return { status: "allowed", remaining: limit - count - 1 };
    });
    const config = { perApi: { limit: 2, windowMs }, sharedCounter: setup({ consume }) };
    const a = withRateLimiting(config);
    const b = withRateLimiting(config);
    const attempts = [invocation(), invocation(), invocation()];
    const anotherItem = { ...request, url: "https://example.test/route/different-id" };
    const outcomes = await Promise.all([
      a(request, attempts[0].context), b(anotherItem, attempts[1].context),
      a(request, attempts[2].context),
    ]);

    expect(outcomes).toEqual([true, true, false]);
    expect(attempts[2].response()).toMatchObject({
      status: 429,
      headers: {
        "Retry-After": "60",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String((windowStart + windowMs) / 1_000),
      },
    });
    const [input, signal] = consume.mock.calls[0];
    expect(input).toEqual({
      bucket: expect.stringMatching(/^[a-f0-9]{64}$/u), limit: 2, windowEndsAtMs: windowStart + windowMs,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(counts.size).toBe(1);
    vi.setSystemTime(windowStart + windowMs);
    expect(await b(request, invocation().context)).toBe(true);
    expect(consume.mock.calls[3][0].windowEndsAtMs).toBe(windowStart + 2 * windowMs);
    expect(counts.size).toBe(2);
  });

  it("requires a verified principal and derives independent opaque keys for scope and principal", async () => {
    clock();
    const consume = vi.fn<SharedRateLimitCounter["consume"]>().mockResolvedValue({ status: "allowed", remaining: 1 });
    const middleware = withRateLimiting({
      global: { limit: 2, windowMs }, perUser: { limit: 2, windowMs },
      perApi: { limit: 2, windowMs }, sharedCounter: setup({ consume }),
    });
    const anonymous = invocation();
    expect(await middleware(request, anonymous.context)).toBe(false);
    expect(anonymous.response()?.status).toBe(503);
    expect(consume).not.toHaveBeenCalled();

    expect(await middleware(request, invocation({ userId: principal }).context)).toBe(true);
    expect(await middleware(request, invocation({ userId: "another-actor" }).context)).toBe(true);
    const ids = consume.mock.calls.map(([input]) => input.bucket);
    expect(new Set(ids.slice(0, 3)).size).toBe(3);
    expect([ids[0], ids[2]]).toEqual([ids[3], ids[5]]);
    expect(ids[1]).not.toEqual(ids[4]);
    expect(JSON.stringify(consume.mock.calls)).not.toMatch(/canary|192\.0\.2\.12/u);
  });

  it("shares the global limit between fixed operations and short-circuits exhausted requests", async () => {
    clock();
    const consume = vi.fn<SharedRateLimitCounter["consume"]>()
      .mockResolvedValueOnce({ status: "allowed", remaining: 0 })
      .mockResolvedValueOnce({ status: "allowed", remaining: 1 })
      .mockResolvedValueOnce({ status: "exhausted" });
    const policy = { global: { limit: 1, windowMs }, perApi: { limit: 2, windowMs } };
    const a = withRateLimiting({ ...policy, sharedCounter: setup({ consume }) });
    const b = withRateLimiting({
      ...policy, sharedCounter: { ...setup({ consume }), routeKey: "review-list" },
    });
    const rejected = invocation();
    expect(await a(request, invocation().context)).toBe(true);
    expect(await b(request, rejected.context)).toBe(false);
    expect(rejected.response()?.status).toBe(429);
    expect(consume).toHaveBeenCalledTimes(3);
    expect(consume.mock.calls[0][0].bucket).toBe(consume.mock.calls[2][0].bucket);
  });

  it.each([
    { status: "unavailable" },
    { status: "allowed", remaining: 2 },
    { status: "allowed", remaining: 0.5 },
    { status: "unknown" },
    null,
  ])("rejects unavailable or invalid counter results without checking later scopes (%j)", async (result) => {
    clock();
    vi.stubEnv("RATE_LIMIT_FAIL_OPEN", "true");
    const consume = vi.fn<SharedRateLimitCounter["consume"]>()
      .mockResolvedValue(result as SharedRateLimitCounterResult);
    const attempt = invocation();
    const middleware = withRateLimiting({
      global: { limit: 2, windowMs }, perApi: { limit: 2, windowMs }, sharedCounter: setup({ consume }),
    });
    expect(await middleware(request, attempt.context)).toBe(false);
    expect(attempt.response()).toMatchObject({ status: 503, headers: { "Cache-Control": "no-store" } });
    expect(consume).toHaveBeenCalledOnce();
  });

  it("keeps provider errors private and rejects an expired admission", async () => {
    clock();
    const consume = vi.fn<SharedRateLimitCounter["consume"]>()
      .mockRejectedValueOnce(new Error("provider-url-and-credential-canary"))
      .mockImplementationOnce(async () => {
        vi.setSystemTime(windowStart + windowMs);
        return { status: "allowed", remaining: 1 };
      });
    const middleware = withRateLimiting({
      global: { limit: 2, windowMs }, sharedCounter: setup({ consume }),
    });
    const error = invocation();
    expect(await middleware(request, error.context)).toBe(false);
    expect(error.response()?.status).toBe(503);
    expect(JSON.stringify([error.warn.mock.calls, error.response()])).not.toMatch(/canary/u);
    const expired = invocation();
    expect(await middleware(request, expired.context)).toBe(false);
    expect(expired.response()?.status).toBe(503);
  });

  it("does not admit a request after an earlier scope rolls over during a later check", async () => {
    clock();
    const consume = vi.fn<SharedRateLimitCounter["consume"]>()
      .mockResolvedValueOnce({ status: "allowed", remaining: 0 })
      .mockImplementationOnce(async () => {
        vi.setSystemTime(windowStart + 1_000);
        return { status: "allowed", remaining: 1 };
      });
    const attempt = invocation();
    const middleware = withRateLimiting({
      global: { limit: 1, windowMs: 1_000 },
      perApi: { limit: 2, windowMs },
      sharedCounter: setup({ consume }),
    });
    expect(await middleware(request, attempt.context)).toBe(false);
    expect(attempt.response()).toMatchObject({
      status: 503,
      headers: { "X-RateLimit-Reset": String((windowStart + 1_000) / 1_000) },
    });
  });

  it("aborts one deadline for the entire middleware and never calls another scope or writes a late response", async () => {
    clock();
    let settle!: (result: SharedRateLimitCounterResult) => void;
    const consume = vi.fn<SharedRateLimitCounter["consume"]>()
      .mockResolvedValueOnce({ status: "allowed", remaining: 0 })
      .mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    const middleware = withRateLimiting({
      global: { limit: 1, windowMs }, perApi: { limit: 1, windowMs }, perUser: { limit: 1, windowMs },
      sharedCounter: { ...setup({ consume }), timeoutMs: 25 },
    });
    const attempt = invocation({ userId: principal });
    const pending = middleware(request, attempt.context);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toBe(false);
    expect(consume.mock.calls[1][1].aborted).toBe(true);
    const response = attempt.response();
    expect(response?.status).toBe(503);

    settle({ status: "exhausted" });
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt.response()).toBe(response);
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe configuration at construction and denies admission without an HMAC key", async () => {
    clock();
    const consume = vi.fn<SharedRateLimitCounter["consume"]>();
    const global = { limit: 1, windowMs };
    const sharedCounter = setup({ consume });
    expect(() => withRateLimiting({ global, sharedCounter, failOpen: true })).toThrow(TypeError);
    expect(() => withRateLimiting({ perApi: global, sharedCounter: { ...sharedCounter, routeKey: undefined } })).toThrow(TypeError);
    expect(() => withRateLimiting({ global, sharedCounter: { ...sharedCounter, namespace: "/bad" } })).toThrow(TypeError);
    expect(() => withRateLimiting({ global, sharedCounter: { ...sharedCounter, timeoutMs: 0 } })).toThrow(TypeError);
    expect(() => withRateLimiting({ global: { ...global, windowMs: Number.NaN }, sharedCounter })).toThrow(TypeError);

    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "");
    vi.stubEnv("HMAC_SECRET", "");
    const attempt = invocation();
    expect(await withRateLimiting({ global, sharedCounter })(request, attempt.context)).toBe(false);
    expect(attempt.response()?.status).toBe(503);
    expect(consume).not.toHaveBeenCalled();
  });
});
