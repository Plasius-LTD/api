import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { afterEach, describe, expect, it, vi } from "vitest";

type RedisLike = {
  incr: (key: string) => Promise<number>;
  pexpire: (key: string, ttlMs: number) => Promise<number>;
  pttl: (key: string) => Promise<number>;
};

const ORIGINAL_REDIS_ENABLED = process.env.REDIS_ENABLED;
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
const ORIGINAL_REDIS_HOST = process.env.REDIS_HOST;
const ORIGINAL_REDIS_PORT = process.env.REDIS_PORT;
const ORIGINAL_REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const ORIGINAL_RATE_LIMIT_HMAC_SECRET = process.env.RATE_LIMIT_HMAC_SECRET;
const ORIGINAL_RATE_LIMIT_FAIL_OPEN = process.env.RATE_LIMIT_FAIL_OPEN;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function createContext(): InvocationContext {
  const context = {
    extraInputs: new Map<string, unknown>(),
    extraOutputs: new Map<string, unknown>(),
  } as unknown as InvocationContext;

  context.extraInputs.set("logger", {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  return context;
}

function createRequest(
  method = "GET",
  url = "https://api.example.com/resource",
  headers: Record<string, string> = {}
): HttpRequest {
  return {
    method,
    url,
    headers: new Headers(headers),
  } as unknown as HttpRequest;
}

async function loadWithRateLimiting(
  options: {
    redisEnabled: boolean;
    redisImplementation?: new (...args: unknown[]) => RedisLike;
    rateLimitSecret?: string;
    nodeEnv?: string;
    failOpen?: string;
  }
) {
  vi.resetModules();
  vi.doMock("ioredis", () => {
    const RedisCtor =
      options.redisImplementation ??
      class RedisMock {
        private counts = new Map<string, number>();
        async incr(key: string) {
          const next = (this.counts.get(key) ?? 0) + 1;
          this.counts.set(key, next);
          return next;
        }
        async pexpire() {
          return 1;
        }
        async pttl() {
          return 2500;
        }
      };
    return { default: RedisCtor };
  });

  process.env.REDIS_ENABLED = options.redisEnabled ? "true" : "false";
  if (options.nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = options.nodeEnv;
  }
  if (options.failOpen === undefined) {
    delete process.env.RATE_LIMIT_FAIL_OPEN;
  } else {
    process.env.RATE_LIMIT_FAIL_OPEN = options.failOpen;
  }
  if (options.redisEnabled) {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
  } else {
    delete process.env.REDIS_URL;
  }
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  delete process.env.REDIS_PASSWORD;
  if (options.rateLimitSecret === undefined) {
    process.env.RATE_LIMIT_HMAC_SECRET = "test-rate-limit-secret";
  } else if (options.rateLimitSecret === "") {
    delete process.env.RATE_LIMIT_HMAC_SECRET;
  } else {
    process.env.RATE_LIMIT_HMAC_SECRET = options.rateLimitSecret;
  }

  return import("../../middleware/withRateLimiting.js");
}

afterEach(() => {
  if (ORIGINAL_REDIS_ENABLED === undefined) {
    delete process.env.REDIS_ENABLED;
  } else {
    process.env.REDIS_ENABLED = ORIGINAL_REDIS_ENABLED;
  }
  if (ORIGINAL_REDIS_URL === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  }
  if (ORIGINAL_REDIS_HOST === undefined) {
    delete process.env.REDIS_HOST;
  } else {
    process.env.REDIS_HOST = ORIGINAL_REDIS_HOST;
  }
  if (ORIGINAL_REDIS_PORT === undefined) {
    delete process.env.REDIS_PORT;
  } else {
    process.env.REDIS_PORT = ORIGINAL_REDIS_PORT;
  }
  if (ORIGINAL_REDIS_PASSWORD === undefined) {
    delete process.env.REDIS_PASSWORD;
  } else {
    process.env.REDIS_PASSWORD = ORIGINAL_REDIS_PASSWORD;
  }
  if (ORIGINAL_RATE_LIMIT_HMAC_SECRET === undefined) {
    delete process.env.RATE_LIMIT_HMAC_SECRET;
  } else {
    process.env.RATE_LIMIT_HMAC_SECRET = ORIGINAL_RATE_LIMIT_HMAC_SECRET;
  }
  if (ORIGINAL_RATE_LIMIT_FAIL_OPEN === undefined) {
    delete process.env.RATE_LIMIT_FAIL_OPEN;
  } else {
    process.env.RATE_LIMIT_FAIL_OPEN = ORIGINAL_RATE_LIMIT_FAIL_OPEN;
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }

  vi.restoreAllMocks();
  vi.resetModules();
});

describe("withRateLimiting", () => {
  it("bypasses checks when redis is disabled", async () => {
    const { withRateLimiting } = await loadWithRateLimiting({ redisEnabled: false });
    const middleware = withRateLimiting({
      global: { limit: 1, windowMs: 1_000 },
      perUser: { limit: 1, windowMs: 1_000 },
      perApi: { limit: 1, windowMs: 1_000 },
    });

    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/admin/flags", {
      "x-user-id": "user-1",
      "x-forwarded-for": "203.0.113.10",
    });

    const shouldContinue = await middleware(request, context);

    expect(shouldContinue).toBe(true);
    expect(context.extraOutputs.get("http")).toBeUndefined();
  });

  it("fails closed in production when redis is disabled", async () => {
    const { withRateLimiting } = await loadWithRateLimiting({
      redisEnabled: false,
      nodeEnv: "production",
    });
    const middleware = withRateLimiting({
      global: { limit: 1, windowMs: 1_000 },
    });

    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/admin/flags");

    const shouldContinue = await middleware(request, context);
    const response = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(response.status).toBe(503);
    expect(String(response.body)).toContain("Rate limiting is temporarily unavailable");
  });

  it("blocks requests when global limit is exceeded", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { withRateLimiting } = await loadWithRateLimiting({ redisEnabled: true });
    const middleware = withRateLimiting({
      global: { limit: 1, windowMs: 1_000 },
    });
    const request = createRequest("GET", "https://api.example.com/resource", {
      authorization: "Bearer raw-token-value",
    });
    const context = createContext();

    expect(await middleware(request, context)).toBe(true);
    const blocked = await middleware(request, context);
    const response = context.extraOutputs.get("http") as HttpResponseInit;

    expect(blocked).toBe(false);
    expect(response.status).toBe(429);
    expect(String(response.body)).toContain("global limit");
    nowSpy.mockRestore();
  });

  it("blocks requests when per-user limit is exceeded", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { withRateLimiting } = await loadWithRateLimiting({ redisEnabled: true });
    const middleware = withRateLimiting({
      perUser: { limit: 0, windowMs: 1_000 },
    });

    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/resource", {
      "x-user-id": "user-99",
    });

    const shouldContinue = await middleware(request, context);
    const response = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(response.status).toBe(429);
    expect(String(response.body)).toContain("user limit");
    nowSpy.mockRestore();
  });

  it("does not use raw authorization tokens or client user headers in Redis keys", async () => {
    const observedKeys: string[] = [];

    class CapturingRedis {
      async incr(key: string) {
        observedKeys.push(key);
        return 1;
      }
      async pexpire() {
        return 1;
      }
      async pttl() {
        return 2500;
      }
    }

    const { withRateLimiting } = await loadWithRateLimiting({
      redisEnabled: true,
      redisImplementation: CapturingRedis as unknown as new (...args: unknown[]) => RedisLike,
    });
    const middleware = withRateLimiting({
      perUser: { limit: 5, windowMs: 1_000 },
    });

    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/resource", {
      authorization: "Bearer raw-token-value",
      "x-user-id": "spoofed-user",
      "x-forwarded-for": "203.0.113.10",
    });

    await middleware(request, context);

    expect(observedKeys).toHaveLength(1);
    expect(observedKeys[0]).toContain("rate:user:auth:");
    expect(observedKeys[0]).not.toContain("raw-token-value");
    expect(observedKeys[0]).not.toContain("spoofed-user");
    expect(observedKeys[0]).not.toContain("203.0.113.10");
  });

  it("blocks requests when per-api limit is exceeded", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { withRateLimiting } = await loadWithRateLimiting({ redisEnabled: true });
    const middleware = withRateLimiting({
      perApi: { limit: 0, windowMs: 1_000 },
    });

    const context = createContext();
    const request = createRequest("DELETE", "https://api.example.com/resource/5");

    const shouldContinue = await middleware(request, context);
    const response = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(response.status).toBe(429);
    expect(String(response.body)).toContain("API is receiving too many requests");
    nowSpy.mockRestore();
  });

  it("fails closed in production when redis backend throws", async () => {
    class ThrowingRedis {
      async incr() {
        throw new Error("redis unavailable");
      }
      async pexpire() {
        return 1;
      }
      async pttl() {
        return 2500;
      }
    }

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { withRateLimiting } = await loadWithRateLimiting({
      redisEnabled: true,
      nodeEnv: "production",
      redisImplementation: ThrowingRedis as unknown as new (...args: unknown[]) => RedisLike,
    });
    const middleware = withRateLimiting({
      global: { limit: 1, windowMs: 1_000 },
    });

    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource");
    const shouldContinue = await middleware(request, context);
    const response = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(response.status).toBe(503);
    const logger = context.extraInputs.get("logger") as {
      warn: ReturnType<typeof vi.fn>;
    };
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("Bearer"));
    nowSpy.mockRestore();
  });
});
