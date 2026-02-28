import { describe, expect, it, afterEach } from "vitest";
import type { HttpRequest } from "@azure/functions";
import {
  applyBaselineSecurityHeaders,
  isHttpsRequest,
  isInsecureLocalRequest,
  shouldEnforceHttps,
} from "../../middleware/transportSecurity.js";

function createRequest(
  url: string,
  headers: Record<string, string> = {}
): HttpRequest {
  return {
    url,
    headers: new Headers(headers),
  } as unknown as HttpRequest;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ENFORCE_HTTPS = process.env.ENFORCE_HTTPS;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ENFORCE_HTTPS === undefined) {
    delete process.env.ENFORCE_HTTPS;
  } else {
    process.env.ENFORCE_HTTPS = ORIGINAL_ENFORCE_HTTPS;
  }
});

describe("transport security helpers", () => {
  it("recognizes https from forwarding headers", () => {
    const request = createRequest("http://internal.local/api", {
      "x-forwarded-proto": "https",
    });
    expect(isHttpsRequest(request)).toBe(true);
  });

  it("recognizes non-https transport", () => {
    const request = createRequest("http://example.com/api");
    expect(isHttpsRequest(request)).toBe(false);
  });

  it("allows insecure localhost requests", () => {
    const request = createRequest("http://localhost:7071/api", {
      host: "localhost:7071",
    });
    expect(isInsecureLocalRequest(request)).toBe(true);
  });

  it("enforces https in production by default", () => {
    delete process.env.ENFORCE_HTTPS;
    process.env.NODE_ENV = "production";
    expect(shouldEnforceHttps()).toBe(true);
  });

  it("supports explicit https enforcement override", () => {
    process.env.NODE_ENV = "production";
    process.env.ENFORCE_HTTPS = "false";
    expect(shouldEnforceHttps()).toBe(false);
  });

  it("applies anti-mitm security headers", () => {
    const headers = new Headers();

    applyBaselineSecurityHeaders(headers);

    expect(headers.get("strict-transport-security")).toContain("max-age=63072000");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});
