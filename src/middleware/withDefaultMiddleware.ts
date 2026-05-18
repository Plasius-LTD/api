// backend/src/middleware/defaultMiddleware.ts

import { withCors } from "./withCors";
import { withSecurity } from "./withSecurity";
import { withRateLimiting } from "./withRateLimiting";
import type { Middleware } from "./withMiddleware.js";
import { withCSRF } from "./withCSRF";
import { withSession } from "./withSession";

function parseConfiguredOrigins(): string[] {
  const configured =
    process.env.CORS_ALLOWED_ORIGINS ??
    process.env.ALLOWED_ORIGINS ??
    process.env.FRONTEND_DOMAIN ??
    process.env.PUBLIC_BASE_URL ??
    process.env.DOMAIN ??
    "";

  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function withDefaultMiddleware(): Middleware[] {
  return [
    withCSRF(),
    withSecurity(),
    withCors(
      parseConfiguredOrigins(),
      ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      [
        "Content-Type",
        "Authorization",
        "x-csrf-token",
        "x-requested-with",
        "Accept",
        "X-Session-Id",
        "Cache-Control",
        "Pragma",
        "If-None-Match",
        "ETag",
      ]
    ),
    withRateLimiting({
      global: { limit: 1000, windowMs: 60 * 1000 }, // 1000 requests per minute
      perUser: { limit: 10, windowMs: 60 * 1000 }, // 100 requests per user per minute
      perApi: { limit: 500, windowMs: 60 * 1000 }, // 500 requests per API endpoint per minute
    }),
    withSession,
  ];
}
