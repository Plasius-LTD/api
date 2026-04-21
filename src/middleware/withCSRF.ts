import { HttpRequest, InvocationContext } from "@azure/functions";
import type { Middleware } from "./withMiddleware";
import { getCookie, getCookieSecurity } from "../utils";
import { randomUUID } from "crypto";
import { getExtraOutputs } from "../utils/index.js";

const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_COOKIE_NAME = "csrf-token";

function normalizePathname(pathname: string): string {
  const normalized = pathname.trim().replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

function shouldSkipCsrfValidation(request: HttpRequest): boolean {
  const method = request.method?.toUpperCase();
  if (!method || method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }

  let pathname: string;
  try {
    pathname = normalizePathname(new URL(request.url).pathname);
  } catch {
    return false;
  }

  const oauthCallbackPattern = /(^|\/)(?:api\/)?oauth\/[^/]+\/callback$/i;
  const appleNotificationPattern = /(^|\/)(?:api\/)?oauth\/apple\/notification$/i;
  const oauthRefreshPattern = /(^|\/)(?:api\/)?oauth\/refresh-token$/i;

  return (
    oauthCallbackPattern.test(pathname) ||
    appleNotificationPattern.test(pathname) ||
    oauthRefreshPattern.test(pathname)
  );
}

export const withCSRF = (): Middleware => {
  return async (request: HttpRequest, context: InvocationContext) => {
    const logger = context.extraInputs.get("logger") as {
      log: (...args: any[]) => void;
      warn: (...args: any[]) => void;
      error: (...args: any[]) => void;
    };

    const { headers, cookies } = getExtraOutputs(context);
    const method = request.method?.toUpperCase();
    const isReadOnly =
      method === "GET" || method === "HEAD" || method === "OPTIONS";

    if (shouldSkipCsrfValidation(request)) {
      logger.log("CSRF validation skipped for OAuth callback/notification route");
      return true;
    }

    // Read token from header and cookie
    const headerToken = request.headers?.get(CSRF_HEADER_NAME);
    const cookieToken = getCookie(request, CSRF_COOKIE_NAME);

    // ✅ If GET and no CSRF cookie set, generate one
    if (isReadOnly && !cookieToken) {
      const newToken = randomUUID();
      const cookieSecurity = getCookieSecurity(request);
      const newCookies = [
        ...cookies,
        {
          name: CSRF_COOKIE_NAME,
          value: newToken,
          ...cookieSecurity,
          path: "/",
          maxAge: 10 * 60, // 10 minutes
        },
      ];

      context.extraOutputs.set("cookies", newCookies);
      logger.log("CSRF token set on GET request");
    }

    // Only validate CSRF token on non-readonly methods
    if (!isReadOnly) {
      if (!headerToken || !cookieToken || headerToken !== cookieToken) {
        logger.warn("CSRF token validation failed.");
        context.extraOutputs.set("http", {
          status: 403,
          headers,
          cookies,
          body: "Invalid CSRF token.",
        });
        return false;
      }
    }

    return true;
  };
};
