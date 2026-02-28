// backend/src/middleware/defaultMiddleware.ts

import { withCors } from "./withCors";
import { withSecurity } from "./withSecurity";
import { withRateLimiting } from "./withRateLimiting";
import type { Middleware } from "./withMiddleware.js";
import { withCSRF } from "./withCSRF";
import { withSession } from "./withSession";

export function withDefaultMiddleware(): Middleware[] {
  return [
    withCSRF(),
    withSecurity(),
    withCors(
      [
        "*",
      ],
      ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      [
        "Content-Type",
        "Authorization",
        "x-csrf-token",
        "x-requested-with",
        "Accept",
        "Cookie",
        "Set-Cookie",
        "Origin",
        "Referer",
        "X-Forwarded-For",
        "X-Real-IP",
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
