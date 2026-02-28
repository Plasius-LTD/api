import crypto from "crypto";

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex"); // 32-char hex string
}

export function verifyState(received: string, expected: string): boolean {
  // Constant-time comparison to prevent timing attacks
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

export interface ParsedOAuthState {
  csrf: string;
  returnTo: string;
  pkceId?: string;
}

const PKCE_ID_PATTERN = /^[a-f0-9]{32}$/;

function normalizeBase64(input: string): string {
  const withStandardChars = input
    .trim()
    .replace(/ /g, "+")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padLength = withStandardChars.length % 4;
  if (padLength === 0) {
    return withStandardChars;
  }

  return withStandardChars.padEnd(
    withStandardChars.length + (4 - padLength),
    "="
  );
}

function sanitizeReturnTo(returnTo: string): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/";
  }
  return returnTo;
}

export function decodeOAuthReturnToState(
  encodedReturnTo: string | null | undefined
): string {
  if (!encodedReturnTo) {
    return "/";
  }

  try {
    const decoded = Buffer.from(normalizeBase64(encodedReturnTo), "base64").toString(
      "utf-8"
    );
    return sanitizeReturnTo(decoded);
  } catch {
    return "/";
  }
}

export function parseEncodedState(encodedState: string): ParsedOAuthState {
  const decoded = Buffer.from(normalizeBase64(encodedState), "base64").toString(
    "utf-8"
  );
  const stateUnknown: unknown = JSON.parse(decoded);
  if (!stateUnknown || typeof stateUnknown !== "object") {
    throw new Error("Malformed state");
  }

  const stateObject = stateUnknown as Record<string, unknown>;
  const csrf = typeof stateObject.csrf === "string" ? stateObject.csrf : undefined;
  const returnToRaw =
    typeof stateObject.returnTo === "string"
      ? stateObject.returnTo
      : typeof stateObject.decodedReturnTo === "string"
        ? stateObject.decodedReturnTo
        : undefined;

  if (!csrf || !returnToRaw) {
    throw new Error("Malformed state");
  }

  const pkceIdRaw = stateObject.pkceId;
  const pkceId =
    typeof pkceIdRaw === "string" && PKCE_ID_PATTERN.test(pkceIdRaw)
      ? pkceIdRaw
      : undefined;

  if (pkceIdRaw !== undefined && !pkceId) {
    throw new Error("Malformed state");
  }

  return { csrf, returnTo: sanitizeReturnTo(returnToRaw), pkceId };
}
