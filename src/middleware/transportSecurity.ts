import type { HttpRequest } from "@azure/functions";

const FORWARDED_PROTO_PATTERN = /(?:^|;)\s*proto=(?:"?)(https|http)(?:"?)(?:;|$)/i;

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function extractHostWithoutPort(value: string | null): string {
  if (!value) return "";
  const host = value.trim().toLowerCase();
  if (!host) return "";
  const withoutIpv6Brackets =
    host.startsWith("[") && host.includes("]")
      ? host.slice(1, host.indexOf("]"))
      : host;
  return withoutIpv6Brackets.split(":")[0] ?? "";
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

export function isHttpsRequest(request: HttpRequest): boolean {
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  if (forwardedProto) {
    return forwardedProto.toLowerCase() === "https";
  }

  const forwardedHeader = request.headers.get("forwarded");
  if (forwardedHeader) {
    const firstForwarded = forwardedHeader.split(",")[0] ?? "";
    const match = firstForwarded.match(FORWARDED_PROTO_PATTERN);
    if (match?.[1]) {
      return match[1].toLowerCase() === "https";
    }
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function isInsecureLocalRequest(request: HttpRequest): boolean {
  const hostHeader = extractHostWithoutPort(request.headers.get("x-forwarded-host"));
  if (hostHeader && isLocalHost(hostHeader)) {
    return true;
  }

  const host = extractHostWithoutPort(request.headers.get("host"));
  if (host && isLocalHost(host)) {
    return true;
  }

  try {
    const requestHost = extractHostWithoutPort(new URL(request.url).hostname);
    if (requestHost && isLocalHost(requestHost)) {
      return true;
    }
  } catch {
    // ignore URL parse failures and fall through
  }

  return false;
}

export function shouldEnforceHttps(): boolean {
  const configured = process.env.ENFORCE_HTTPS?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function applyBaselineSecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=()"
  );
  headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-site");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
}
