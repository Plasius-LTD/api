import type { HttpRequest, InvocationContext } from "@azure/functions";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractAndHashClientIp,
  getCookie,
  getCookieSecurity,
  getExtraOutputs,
  resolvePublicBaseUrl,
  resolveRequestPath,
  setCookie,
} from "../../utils/index.js";

function createRequest(
  headers: Record<string, string> = {},
  url = "https://api.example.test/path?token=secret"
): HttpRequest {
  return {
    headers: new Headers(headers),
    url,
  } as unknown as HttpRequest;
}

const ORIGINAL_HMAC_SECRET = process.env.HMAC_SECRET;
const ORIGINAL_TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS;
const ORIGINAL_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const ORIGINAL_FRONTEND_DOMAIN = process.env.FRONTEND_DOMAIN;
const ORIGINAL_DOMAIN = process.env.DOMAIN;
const ORIGINAL_AUTH_COOKIE_SAME_SITE = process.env.AUTH_COOKIE_SAME_SITE;
const ORIGINAL_COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE;

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
  if (ORIGINAL_PUBLIC_BASE_URL === undefined) {
    delete process.env.PUBLIC_BASE_URL;
  } else {
    process.env.PUBLIC_BASE_URL = ORIGINAL_PUBLIC_BASE_URL;
  }
  if (ORIGINAL_FRONTEND_DOMAIN === undefined) {
    delete process.env.FRONTEND_DOMAIN;
  } else {
    process.env.FRONTEND_DOMAIN = ORIGINAL_FRONTEND_DOMAIN;
  }
  if (ORIGINAL_DOMAIN === undefined) {
    delete process.env.DOMAIN;
  } else {
    process.env.DOMAIN = ORIGINAL_DOMAIN;
  }
  if (ORIGINAL_AUTH_COOKIE_SAME_SITE === undefined) {
    delete process.env.AUTH_COOKIE_SAME_SITE;
  } else {
    process.env.AUTH_COOKIE_SAME_SITE = ORIGINAL_AUTH_COOKIE_SAME_SITE;
  }
  if (ORIGINAL_COOKIE_SAME_SITE === undefined) {
    delete process.env.COOKIE_SAME_SITE;
  } else {
    process.env.COOKIE_SAME_SITE = ORIGINAL_COOKIE_SAME_SITE;
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

describe("request URL helpers", () => {
  it("prefers configured public origins over spoofable request headers", () => {
    process.env.PUBLIC_BASE_URL = "https://configured.example/app";
    process.env.TRUST_PROXY_HEADERS = "true";
    const request = createRequest({
      origin: "https://attacker.example",
      referer: "https://attacker.example/session",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "proxy.example",
    });

    expect(resolvePublicBaseUrl(request)).toBe("https://configured.example");
  });

  it("falls back through configured frontend and domain values", () => {
    process.env.FRONTEND_DOMAIN = "https://frontend.example/app";
    const frontendRequest = createRequest();

    expect(resolvePublicBaseUrl(frontendRequest)).toBe("https://frontend.example");

    delete process.env.FRONTEND_DOMAIN;
    process.env.DOMAIN = "https://domain.example/ignored";

    expect(resolvePublicBaseUrl(createRequest())).toBe("https://domain.example");
  });

  it("uses forwarded proto and host only when proxy headers are trusted", () => {
    const request = createRequest({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "forwarded.example, ignored.example",
    });

    expect(resolvePublicBaseUrl(request)).toBe("https://api.example.test");

    process.env.TRUST_PROXY_HEADERS = "true";

    expect(resolvePublicBaseUrl(request)).toBe("https://forwarded.example");
  });

  it("parses the standard Forwarded header when trusted", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    const request = createRequest({
      forwarded: 'for=203.0.113.10;proto="https";host="forwarded.example"',
    });

    expect(resolvePublicBaseUrl(request)).toBe("https://forwarded.example");
  });

  it("ignores malformed public URL sources and falls back safely", () => {
    process.env.PUBLIC_BASE_URL = "not a url";
    process.env.FRONTEND_DOMAIN = "";
    process.env.DOMAIN = "also not a url";
    process.env.TRUST_PROXY_HEADERS = "true";
    const request = createRequest(
      {
        forwarded: "for=203.0.113.10;proto=https",
        "x-forwarded-proto": "https",
      },
      "also not a url"
    );

    expect(resolvePublicBaseUrl(request)).toBe("http://localhost:5173");
  });

  it("derives cookie security from the resolved public URL and explicit SameSite policy", () => {
    process.env.PUBLIC_BASE_URL = "https://configured.example";
    process.env.AUTH_COOKIE_SAME_SITE = "Strict";

    expect(getCookieSecurity(createRequest())).toEqual({
      secure: true,
      sameSite: "Strict",
    });
  });

  it("downgrades SameSite=None when the cookie cannot be secure", () => {
    process.env.PUBLIC_BASE_URL = "http://localhost:5173";
    process.env.AUTH_COOKIE_SAME_SITE = "None";

    expect(getCookieSecurity(createRequest())).toEqual({
      secure: false,
      sameSite: "Lax",
    });
  });

  it("extracts path only from absolute, relative, and malformed URLs", () => {
    expect(resolveRequestPath("https://api.example.test/a/b?token=secret")).toBe("/a/b");
    expect(resolveRequestPath("/relative/path?token=secret")).toBe("/relative/path");
    expect(resolveRequestPath("?token=secret")).toBe("/");
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
