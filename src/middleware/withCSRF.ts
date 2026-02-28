import { Cookie, HttpRequest, InvocationContext } from "@azure/functions";
import type { Middleware } from "./withMiddleware";
import { getCookie } from "../utils";
import { randomUUID } from "crypto";
import { getExtraOutputs } from "../utils/index.js";

const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_COOKIE_NAME = "csrf-token";

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

    // Read token from header and cookie
    const headerToken = request.headers?.get(CSRF_HEADER_NAME);
    const cookieToken = getCookie(request, CSRF_COOKIE_NAME);

    // ✅ If GET and no CSRF cookie set, generate one
    if (isReadOnly && !cookieToken) {
      const newToken = randomUUID();
      const newCookies = [
        ...cookies,
        {
          name: CSRF_COOKIE_NAME,
          value: newToken,
          secure: true,
          sameSite: "None",
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
