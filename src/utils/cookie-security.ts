import type { HttpRequest } from "@azure/functions";

export type CookieSameSite = "None" | "Lax" | "Strict";

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function getForwardedBaseUrl(request: HttpRequest): string | null {
  if ((process.env.TRUST_PROXY_HEADERS ?? "false").toLowerCase() !== "true") {
    return null;
  }

  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (forwardedProto && forwardedHost) {
    return normalizeBaseUrl(`${forwardedProto}://${forwardedHost}`);
  }

  const forwarded = request.headers.get("forwarded");
  if (!forwarded) {
    return null;
  }

  const firstForwardedValue = forwarded.split(",")[0] ?? "";
  const parts = firstForwardedValue
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const kvPairs = Object.fromEntries(
    parts.map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex < 0) {
        return [part.toLowerCase(), ""];
      }

      const key = part.slice(0, separatorIndex).trim().toLowerCase();
      const nextValue = part.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "");
      return [key, nextValue];
    })
  );

  const proto =
    typeof kvPairs.proto === "string" && kvPairs.proto.length > 0
      ? kvPairs.proto
      : null;
  const host =
    typeof kvPairs.host === "string" && kvPairs.host.length > 0
      ? kvPairs.host
      : null;

  if (!proto || !host) {
    return null;
  }

  return normalizeBaseUrl(`${proto}://${host}`);
}

export function resolvePublicBaseUrl(request: HttpRequest): string {
  const configuredPublicBase = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
  const frontendDomain = normalizeBaseUrl(process.env.FRONTEND_DOMAIN);
  const configuredDomain = normalizeBaseUrl(process.env.DOMAIN);
  const requestBaseUrl = normalizeBaseUrl(request.url);

  const resolved =
    configuredPublicBase ??
    frontendDomain ??
    configuredDomain ??
    getForwardedBaseUrl(request) ??
    requestBaseUrl;

  return resolved ?? "http://localhost:5173";
}

function resolveCookieSameSite(secure: boolean): CookieSameSite {
  const raw =
    process.env.AUTH_COOKIE_SAME_SITE ??
    process.env.COOKIE_SAME_SITE ??
    "Lax";
  const normalized = raw.trim().toLowerCase();

  if (normalized === "strict") {
    return "Strict";
  }

  if (normalized === "none") {
    return secure ? "None" : "Lax";
  }

  return "Lax";
}

export function getCookieSecurity(request: HttpRequest): {
  secure: boolean;
  sameSite: CookieSameSite;
} {
  const baseUrl = resolvePublicBaseUrl(request);
  const secure = baseUrl.startsWith("https://");

  return {
    secure,
    sameSite: resolveCookieSameSite(secure),
  };
}
