import { describe, expect, it } from "vitest";
import {
  generatePkceCodeChallenge,
  generatePkceCodeVerifier,
  generatePkceCookieId,
  getPkceCookieName,
  isValidPkceCodeVerifier,
  isValidPkceCookieId,
} from "../../utils/oauth-pkce.js";
import {
  decodeOAuthReturnToState,
  parseEncodedState,
  verifyState,
} from "../../utils/state.js";

function encodeState(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64");
}

describe("oauth PKCE utilities", () => {
  it("generates an RFC 7636-compliant verifier", () => {
    const verifier = generatePkceCodeVerifier();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(isValidPkceCodeVerifier(verifier)).toBe(true);
  });

  it("generates the RFC 7636 Appendix B challenge", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    expect(generatePkceCodeChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("generates PKCE cookie ids and names", () => {
    const pkceId = generatePkceCookieId();

    expect(isValidPkceCookieId(pkceId)).toBe(true);
    expect(getPkceCookieName(pkceId)).toBe(`oauth_pkce_${pkceId}`);
  });
});

describe("oauth state utilities", () => {
  it("parses state with returnTo and pkceId", () => {
    const encoded = encodeState({
      csrf: "abc",
      returnTo: "/dashboard",
      pkceId: "0123456789abcdef0123456789abcdef",
    });

    const parsed = parseEncodedState(encoded);

    expect(parsed).toEqual({
      csrf: "abc",
      returnTo: "/dashboard",
      pkceId: "0123456789abcdef0123456789abcdef",
    });
  });

  it("parses legacy state with decodedReturnTo", () => {
    const encoded = encodeState({ csrf: "abc", decodedReturnTo: "/profile" });

    const parsed = parseEncodedState(encoded);

    expect(parsed).toEqual({ csrf: "abc", returnTo: "/profile", pkceId: undefined });
  });

  it("normalizes invalid returnTo to root", () => {
    const encoded = encodeState({ csrf: "abc", returnTo: "https://evil.example" });

    const parsed = parseEncodedState(encoded);

    expect(parsed.returnTo).toBe("/");
  });

  it("decodes returnTo from query-state and defaults safely", () => {
    expect(decodeOAuthReturnToState("L2Rhc2hib2FyZA==")).toBe("/dashboard");
    expect(decodeOAuthReturnToState(null)).toBe("/");
    expect(decodeOAuthReturnToState("%%%")).toBe("/");
  });

  it("returns false for state length mismatch without throwing", () => {
    expect(verifyState("a", "bb")).toBe(false);
  });
});
