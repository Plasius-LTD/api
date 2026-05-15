import { HttpRequest } from "@azure/functions";
import { createHmac } from "crypto";

export interface ClientIpExtractionOptions {
  trustProxyHeaders?: boolean;
}

function getHmacSecret(): string {
  const secret = process.env.HMAC_SECRET?.trim();
  if (!secret) {
    throw new Error("HMAC_SECRET is required before hashing client IP addresses.");
  }
  return secret;
}

function shouldTrustProxyHeaders(options?: ClientIpExtractionOptions): boolean {
  return (
    options?.trustProxyHeaders ??
    (process.env.TRUST_PROXY_HEADERS ?? "false").toLowerCase() === "true"
  );
}

export function extractAndHashClientIp(
  req: HttpRequest,
  options?: ClientIpExtractionOptions
): string {
  const rawIp = shouldTrustProxyHeaders(options)
    ? (
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip")?.trim() ||
        req.headers.get("x-client-ip")?.trim() ||
        "unknown"
      )
    : "unknown";
  const ip = createHmac("sha256", getHmacSecret()).update(rawIp).digest("hex");
  return ip;
}
