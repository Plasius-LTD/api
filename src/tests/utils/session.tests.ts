import type { HttpRequest } from "@azure/functions";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_COOKIE_NAME,
  createSessionCookie,
  ensureSession,
  getSessionIdFromRequest,
} from "../../utils/session.js";

function createRequest(cookieHeader?: string): HttpRequest {
  return {
    headers: new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
  } as unknown as HttpRequest;
}

describe("session helpers", () => {
  it("reads existing session id from request cookies", () => {
    const request = createRequest("sessionId=existing-session; other=value");
    expect(getSessionIdFromRequest(request)).toBe("existing-session");
  });

  it("returns existing session without issuing a new cookie", () => {
    const request = createRequest("sessionId=existing-session");
    const session = ensureSession(request);

    expect(session.isNew).toBe(false);
    expect(session.sessionId).toBe("existing-session");
    expect(session.cookie).toBeUndefined();
    expect(session.cookieName).toBe(DEFAULT_SESSION_COOKIE_NAME);
  });

  it("creates a new secure cookie when no session is present", () => {
    const request = createRequest();
    const session = ensureSession(request, {
      generateSessionId: () => "generated-session-id",
    });

    expect(session.isNew).toBe(true);
    expect(session.sessionId).toBe("generated-session-id");
    expect(session.cookie).toEqual({
      name: DEFAULT_SESSION_COOKIE_NAME,
      value: "generated-session-id",
      path: "/",
      httpOnly: true,
      sameSite: "None",
      secure: true,
    });
  });

  it("allows overriding cookie attributes for specialized environments", () => {
    const cookie = createSessionCookie("session", {
      cookieName: "custom-session",
      cookieOptions: {
        domain: "example.com",
        maxAge: 3600,
        sameSite: "Lax",
        secure: false,
      },
    });

    expect(cookie).toEqual({
      name: "custom-session",
      value: "session",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      domain: "example.com",
      maxAge: 3600,
    });
  });
});
