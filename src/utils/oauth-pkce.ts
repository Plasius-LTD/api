import crypto from "crypto";

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_COOKIE_ID_PATTERN = /^[a-f0-9]{32}$/;

function toBase64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generatePkceCookieId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getPkceCookieName(pkceId: string): string {
  return `oauth_pkce_${pkceId}`;
}

export function isValidPkceCookieId(pkceId: string): boolean {
  return PKCE_COOKIE_ID_PATTERN.test(pkceId);
}

export function generatePkceCodeVerifier(): string {
  const verifier = toBase64Url(crypto.randomBytes(64));
  if (!isValidPkceCodeVerifier(verifier)) {
    throw new Error("Generated an invalid PKCE code verifier");
  }
  return verifier;
}

export function isValidPkceCodeVerifier(codeVerifier: string): boolean {
  return PKCE_VERIFIER_PATTERN.test(codeVerifier);
}

export function generatePkceCodeChallenge(codeVerifier: string): string {
  if (!isValidPkceCodeVerifier(codeVerifier)) {
    throw new Error("Invalid PKCE code verifier");
  }
  return toBase64Url(crypto.createHash("sha256").update(codeVerifier).digest());
}
