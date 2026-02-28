import { describe, expect, it } from "vitest";
import {
  applyBaselineSecurityHeaders,
  generatePkceCodeVerifier,
  getPkceCookieName,
  isValidPkceCodeVerifier,
  isHttpsRequest,
  parseEncodedState,
  shouldEnforceHttps,
} from "../index.js";

describe("public API helper entrypoint", () => {
  it("exports generic transport-security helpers", () => {
    expect(typeof applyBaselineSecurityHeaders).toBe("function");
    expect(typeof isHttpsRequest).toBe("function");
    expect(typeof shouldEnforceHttps).toBe("function");
  });

  it("exports generic PKCE/state helpers", () => {
    const verifier = generatePkceCodeVerifier();
    expect(isValidPkceCodeVerifier(verifier)).toBe(true);
    expect(getPkceCookieName("0123456789abcdef0123456789abcdef")).toBe(
      "oauth_pkce_0123456789abcdef0123456789abcdef"
    );

    const state = Buffer.from(
      JSON.stringify({ csrf: "abc", returnTo: "/dashboard" }),
      "utf-8"
    ).toString("base64");
    expect(parseEncodedState(state)).toEqual({
      csrf: "abc",
      returnTo: "/dashboard",
      pkceId: undefined,
    });
  });
});
