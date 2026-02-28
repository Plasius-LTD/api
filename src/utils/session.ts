import type { Cookie, HttpRequest } from "@azure/functions";
import { randomUUID } from "crypto";
import { getCookie } from "./cookies.js";

export const DEFAULT_SESSION_COOKIE_NAME = "sessionId";

export interface SessionCookieOptions {
  domain?: string;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  secure?: boolean;
}

export interface SessionOptions {
  cookieName?: string;
  cookieOptions?: SessionCookieOptions;
  generateSessionId?: () => string;
}

export interface SessionResult {
  cookie?: Cookie;
  cookieName: string;
  isNew: boolean;
  sessionId: string;
}

const DEFAULT_SESSION_COOKIE_OPTIONS: Required<
  Pick<SessionCookieOptions, "httpOnly" | "path" | "sameSite" | "secure">
> = {
  httpOnly: true,
  path: "/",
  sameSite: "None",
  secure: true,
};

export function getSessionIdFromRequest(
  request: HttpRequest,
  cookieName: string = DEFAULT_SESSION_COOKIE_NAME
): string | undefined {
  return getCookie(request, cookieName);
}

export function createSessionCookie(
  sessionId: string,
  options: SessionOptions = {}
): Cookie {
  const cookieName = options.cookieName ?? DEFAULT_SESSION_COOKIE_NAME;
  const cookieOptions = {
    ...DEFAULT_SESSION_COOKIE_OPTIONS,
    ...(options.cookieOptions ?? {}),
  };

  const cookie: Cookie = {
    name: cookieName,
    value: sessionId,
    path: cookieOptions.path,
    httpOnly: cookieOptions.httpOnly,
    sameSite: cookieOptions.sameSite,
    secure: cookieOptions.secure,
  };

  if (cookieOptions.domain) {
    cookie.domain = cookieOptions.domain;
  }

  if (typeof cookieOptions.maxAge === "number") {
    cookie.maxAge = cookieOptions.maxAge;
  }

  return cookie;
}

export function ensureSession(
  request: HttpRequest,
  options: SessionOptions = {}
): SessionResult {
  const cookieName = options.cookieName ?? DEFAULT_SESSION_COOKIE_NAME;
  const existingSessionId = getSessionIdFromRequest(request, cookieName);

  if (existingSessionId) {
    return {
      cookieName,
      isNew: false,
      sessionId: existingSessionId,
    };
  }

  const sessionId = (options.generateSessionId ?? randomUUID)();
  if (!sessionId) {
    throw new Error("Session id generator returned an empty value");
  }

  return {
    cookie: createSessionCookie(sessionId, options),
    cookieName,
    isNew: true,
    sessionId,
  };
}
