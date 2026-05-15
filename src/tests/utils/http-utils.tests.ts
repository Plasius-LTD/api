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
const ORIGINAL_TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS;

beforeEach(() => {
  process.env.HMAC_SECRET = "test-ip-hash-secret";
});

afterEach(() => {
  if (ORIGINAL_HMAC_SECRET === undefined) {
    delete process.env.HMAC_SECRET;
  } else {
    process.env.HMAC_SECRET = ORIGINAL_HMAC_SECRET;
  }
  if (ORIGINAL_TRUST_PROXY_HEADERS === undefined) {
    delete process.env.TRUST_PROXY_HEADERS;
  } else {
    process.env.TRUST_PROXY_HEADERS = ORIGINAL_TRUST_PROXY_HEADERS;
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
  it("hashes the first forwarded IP only when proxy headers are trusted", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
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

  it("ignores spoofable client IP headers unless proxy headers are trusted", () => {
    const spoofed = createRequest({
      "x-forwarded-for": "203.0.113.10",
      "x-client-ip": "198.51.100.7",
      host: "api.internal.local",
    });
    const withoutHeaders = createRequest();

    const spoofedHash = extractAndHashClientIp(spoofed);
    const unknownHash = extractAndHashClientIp(withoutHeaders);
    const expected = createHmac("sha256", "test-ip-hash-secret")
      .update("unknown")
      .digest("hex");

    expect(spoofedHash).toBe(expected);
    expect(spoofedHash).toBe(unknownHash);
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
