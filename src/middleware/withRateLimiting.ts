import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";
import Redis from "ioredis";

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface ApiRateLimiterConfig {
  global?: RateLimitConfig;
  perUser?: RateLimitConfig;
  perApi?: RateLimitConfig;
}

const redisUrl = process.env.REDIS_URL?.trim();
const redisHost = process.env.REDIS_HOST?.trim();
const redisEnabled =
  (process.env.REDIS_ENABLED ??
    ((redisUrl || redisHost) ? "true" : "false")).toLowerCase() === "true";

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (!redisEnabled) {
    return null;
  }

  if (redisClient !== undefined) {
    return redisClient;
  }

  redisClient = redisUrl
    ? new Redis(redisUrl, { lazyConnect: true })
    : new Redis({
        host: redisHost ?? "redis",
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD,
        lazyConnect: true,
      });

  return redisClient;
}

async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  context: InvocationContext
): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
  reset: number;
}> {
  const logger = context.extraInputs.get("logger") as {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  }
  const now = Date.now();
  const windowKey = `${key}:${Math.floor(now / config.windowMs)}`;

  const redis = getRedisClient();
  if (!redis) {
    logger?.log(`Rate limiting bypassed for ${key} (Redis disabled)`);
    return {
      allowed: true,
      remaining: config.limit,
      reset: Math.ceil((now + config.windowMs) / 1000),
    };
  }

  try {
    const count = await redis.incr(windowKey);
    if (count === 1) {
      await redis.pexpire(windowKey, config.windowMs);
    }

    const ttl = await redis.pttl(windowKey);
    const retryAfter = count > config.limit ? Math.ceil(ttl / 1000) : undefined;
    const remaining = Math.max(config.limit - count, 0);
    const reset = Math.ceil((now + ttl) / 1000); // Unix timestamp when reset will happen

    if (count > config.limit) {
      logger?.warn(`Rate limit exceeded for ${key}. Retry after ${retryAfter}s.`);
      return { allowed: false, remaining: 0, retryAfter, reset };
    }

    return { allowed: true, remaining, reset };
  } catch (error: unknown) {
    logger?.warn(`Rate limit backend unavailable for ${key}; allowing request.`);
    logger?.warn(error);
    return {
      allowed: true,
      remaining: config.limit,
      reset: Math.ceil((now + config.windowMs) / 1000),
    };
  }
}

export function withRateLimiting(config: ApiRateLimiterConfig): Middleware {
  return async (req: HttpRequest, context: InvocationContext) => {
    const path = new URL(req.url).pathname;

    // ----- GLOBAL -----
    if (config.global) {
      const result = await checkRateLimit(
        "rate:global",
        config.global,
        context
      );
      if (!result.allowed) {
        context.extraOutputs.set("http", {
          status: 429,
          body: "Server is busy (global limit). Please retry later.",
          headers: {
            "Retry-After": result.retryAfter?.toString(),
            "X-RateLimit-Limit": config.global.limit.toString(),
            "X-RateLimit-Remaining": result.remaining.toString(),
            "X-RateLimit-Reset": result.reset.toString(),
          },
        });
        return false;
      }
    }

    // ----- PER USER -----
    if (config.perUser) {
      const userId =
        req.headers.get("x-user-id") ||
        req.headers.get("authorization") ||
        req.headers.get("x-forwarded-for") ||
        "anonymous";
      const result = await checkRateLimit(
        `rate:user:${userId}`,
        config.perUser,
        context
      );
      if (!result.allowed) {
        context.extraOutputs.set("http", {
          status: 429,
          body: "You are sending requests too fast (user limit). Please retry later.",
          headers: {
            "Retry-After": result.retryAfter?.toString(),
            "X-RateLimit-Limit": config.perUser.limit.toString(),
            "X-RateLimit-Remaining": result.remaining.toString(),
            "X-RateLimit-Reset": result.reset.toString(),
          },
        });
        return false;
      }
    }

    // ----- PER API -----
    if (config.perApi) {
      const apiKey = req.method + ":" + path;
      const result = await checkRateLimit(
        `rate:api:${apiKey}`,
        config.perApi,
        context
      );
      if (!result.allowed) {
        context.extraOutputs.set("http", {
          status: 429,
          body: "This API is receiving too many requests. Please retry later.",
          headers: {
            "Retry-After": result.retryAfter?.toString(),
            "X-RateLimit-Limit": config.perApi.limit.toString(),
            "X-RateLimit-Remaining": result.remaining.toString(),
            "X-RateLimit-Reset": result.reset.toString(),
          },
        });
        return false;
      }
    }

    // All passed
    return true;
  };
}
