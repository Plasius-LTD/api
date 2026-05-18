import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";
import Redis from "ioredis";
import { createHmac } from "node:crypto";

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface ApiRateLimiterConfig {
  global?: RateLimitConfig;
  perUser?: RateLimitConfig;
  perApi?: RateLimitConfig;
  trustProxyHeaders?: boolean;
  failOpen?: boolean;
}

const redisUrl = process.env.REDIS_URL?.trim();
const redisHost = process.env.REDIS_HOST?.trim();
const redisEnabled =
  (process.env.REDIS_ENABLED ??
    ((redisUrl || redisHost) ? "true" : "false")).toLowerCase() === "true";

let redisClient: Redis | null | undefined;

function getRuntimeHmacSecret(): string {
  const secret =
    process.env.RATE_LIMIT_HMAC_SECRET?.trim() ||
    process.env.HMAC_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "RATE_LIMIT_HMAC_SECRET or HMAC_SECRET is required for privacy-safe rate limiting."
    );
  }

  return secret;
}

function hmacValue(value: string): string {
  return createHmac("sha256", getRuntimeHmacSecret())
    .update(value)
    .digest("hex");
}

function getHeaderValue(req: HttpRequest, name: string): string | undefined {
  const value = req.headers.get(name)?.trim();
  return value ? value : undefined;
}

function getContextPrincipal(context: InvocationContext): string | undefined {
  const user = context.extraInputs.get("user");
  if (!user || typeof user !== "object") {
    return undefined;
  }

  const record = user as Record<string, unknown>;
  const candidate = record.userId ?? record.id ?? record.sub ?? record.subject;

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function shouldTrustProxyHeaders(config: ApiRateLimiterConfig): boolean {
  return (
    config.trustProxyHeaders ??
    (process.env.TRUST_PROXY_HEADERS ?? "false").toLowerCase() === "true"
  );
}

function shouldFailOpen(config: ApiRateLimiterConfig): boolean {
  if (config.failOpen !== undefined) {
    return config.failOpen;
  }

  const configured = process.env.RATE_LIMIT_FAIL_OPEN?.trim().toLowerCase();
  if (configured === "true") {
    return true;
  }
  if (configured === "false") {
    return false;
  }

  return process.env.NODE_ENV !== "production";
}

function createPerUserRateLimitKey(
  req: HttpRequest,
  context: InvocationContext,
  config: ApiRateLimiterConfig
): string {
  const principal = getContextPrincipal(context);
  if (principal) {
    return `rate:user:principal:${hmacValue(principal)}`;
  }

  const authorization = getHeaderValue(req, "authorization");
  if (authorization) {
    return `rate:user:auth:${hmacValue(authorization)}`;
  }

  if (shouldTrustProxyHeaders(config)) {
    const forwardedFor = getHeaderValue(req, "x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    const clientIp =
      forwardedFor ||
      getHeaderValue(req, "x-real-ip") ||
      getHeaderValue(req, "x-client-ip");

    if (clientIp) {
      return `rate:user:ip:${hmacValue(clientIp)}`;
    }
  }

  return "rate:user:anonymous";
}

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
  limiterConfig: ApiRateLimiterConfig,
  context: InvocationContext,
  label: string
): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
  reset: number;
  unavailable?: boolean;
}> {
  const logger = context.extraInputs.get("logger") as {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  const now = Date.now();
  const windowKey = `${key}:${Math.floor(now / config.windowMs)}`;

  const redis = getRedisClient();
  if (!redis) {
    if (shouldFailOpen(limiterConfig)) {
      logger?.log(`Rate limiting bypassed for ${label} (Redis disabled)`);
      return {
        allowed: true,
        remaining: config.limit,
        reset: Math.ceil((now + config.windowMs) / 1000),
      };
    }

    logger?.warn(`Rate limiting unavailable for ${label} (Redis disabled); rejecting request.`);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil(config.windowMs / 1000),
      reset: Math.ceil((now + config.windowMs) / 1000),
      unavailable: true,
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
      logger?.warn(`Rate limit exceeded for ${label}. Retry after ${retryAfter}s.`);
      return { allowed: false, remaining: 0, retryAfter, reset };
    }

    return { allowed: true, remaining, reset };
  } catch (error: unknown) {
    if (shouldFailOpen(limiterConfig)) {
      logger?.warn(`Rate limit backend unavailable for ${label}; allowing request.`);
      logger?.warn(error);
      return {
        allowed: true,
        remaining: config.limit,
        reset: Math.ceil((now + config.windowMs) / 1000),
      };
    }

    logger?.warn(`Rate limit backend unavailable for ${label}; rejecting request.`);
    logger?.warn(error);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil(config.windowMs / 1000),
      reset: Math.ceil((now + config.windowMs) / 1000),
      unavailable: true,
    };
  }
}

function rateLimitStatus(result: { unavailable?: boolean }): number {
  return result.unavailable ? 503 : 429;
}

function rateLimitBody(result: { unavailable?: boolean }, limitedBody: string): string {
  return result.unavailable
    ? "Rate limiting is temporarily unavailable. Please retry later."
    : limitedBody;
}

export function withRateLimiting(config: ApiRateLimiterConfig): Middleware {
  return async (req: HttpRequest, context: InvocationContext) => {
    const path = new URL(req.url).pathname;

    // ----- GLOBAL -----
    if (config.global) {
      const result = await checkRateLimit(
        "rate:global",
        config.global,
        config,
        context,
        "global"
      );
      if (!result.allowed) {
        context.extraOutputs.set("http", {
          status: rateLimitStatus(result),
          body: rateLimitBody(result, "Server is busy (global limit). Please retry later."),
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
      const result = await checkRateLimit(
        createPerUserRateLimitKey(req, context, config),
        config.perUser,
        config,
        context,
        "user"
      );
      if (!result.allowed) {
        context.extraOutputs.set("http", {
          status: rateLimitStatus(result),
          body: rateLimitBody(result, "You are sending requests too fast (user limit). Please retry later."),
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
        config,
        context,
        "api"
      );
      if (!result.allowed) {
        context.extraOutputs.set("http", {
          status: rateLimitStatus(result),
          body: rateLimitBody(result, "This API is receiving too many requests. Please retry later."),
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
