import type { HttpRequest, InvocationContext } from "@azure/functions";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractAndHashClientIp,
  getCookie,
  getExtraOutputs,
  setCookie,
} from "../../utils/index.js";

function createRequest(headers: Record<string, string> = {}): HttpRequest {
  return {
    headers: new Headers(headers),
  } as unknown as HttpRequest;
}

const ORIGINAL_HMAC_SECRET = process.env.HMAC_SECRET;

beforeEach(() => {
  process.env.HMAC_SECRET = "test-ip-hash-secret";
});

afterEach(() => {
  if (ORIGINAL_HMAC_SECRET === undefined) {
    delete process.env.HMAC_SECRET;
  } else {
    process.env.HMAC_SECRET = ORIGINAL_HMAC_SECRET;
  }
});

describe("cookie helpers", () => {
  it("serializes cookie attributes", () => {
    const cookie = setCookie("session", "value with spaces", {
      maxAge: 900,
      httpOnly: true,
      secure: true,
      sameSite: "None",
      path: "/api",
      domain: "example.com",
    });

    expect(cookie).toContain("session=value%20with%20spaces");
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Domain=example.com");
    expect(cookie).toContain("Path=/api");
  });

  it("reads cookies from either cookie or Cookie header and decodes values", () => {
    const lowerCase = createRequest({
      cookie: "alpha=1; target=hello%20world",
    });
    const upperCase = createRequest({
      Cookie: "target=abc%2F123",
    });

    expect(getCookie(lowerCase, "target")).toBe("hello world");
    expect(getCookie(upperCase, "target")).toBe("abc/123");
    expect(getCookie(upperCase, "missing")).toBeUndefined();
  });
});

describe("request context helpers", () => {
  it("returns existing headers/cookies from context extra outputs", () => {
    const headers = new Headers({ "x-test": "1" });
    const cookies = [{ name: "session", value: "s1" }];
    const context = {
      extraOutputs: new Map<string, unknown>([
        ["headers", headers],
        ["cookies", cookies],
      ]),
    } as unknown as InvocationContext;

    const out = getExtraOutputs(context);

    expect(out.headers.get("x-test")).toBe("1");
    expect(out.cookies).toEqual(cookies);
  });

  it("initializes empty headers/cookies when none are present", () => {
    const context = {
      extraOutputs: new Map<string, unknown>(),
    } as unknown as InvocationContext;

    const out = getExtraOutputs(context);

    expect(out.headers).toBeInstanceOf(Headers);
    expect(out.cookies).toEqual([]);
  });
});

describe("IP hashing helper", () => {
  it("hashes the first forwarded IP when x-forwarded-for is present", () => {
    const request = createRequest({
      "x-forwarded-for": "203.0.113.10, 203.0.113.11",
    });

    const hash = extractAndHashClientIp(request);
    const expected = createHmac(
      "sha256",
      "test-ip-hash-secret"
    )
      .update("203.0.113.10")
      .digest("hex");

    expect(hash).toBe(expected);
  });

  it("falls back to host then unknown when client ip headers are absent", () => {
    const withHost = createRequest({ host: "api.internal.local" });
    const withoutHost = createRequest();

    const withHostHash = extractAndHashClientIp(withHost);
    const unknownHash = extractAndHashClientIp(withoutHost);

    expect(withHostHash).not.toBe(unknownHash);
    expect(withHostHash).toHaveLength(64);
    expect(unknownHash).toHaveLength(64);
  });

  it("requires an explicit hmac secret", () => {
    delete process.env.HMAC_SECRET;
    const request = createRequest({
      "x-forwarded-for": "203.0.113.10",
    });

    expect(() => extractAndHashClientIp(request)).toThrow(/HMAC_SECRET/);
  });
});
