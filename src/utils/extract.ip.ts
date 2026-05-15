import { HttpRequest } from "@azure/functions";
import { createHmac } from "crypto";

function getHmacSecret(): string {
  const secret = process.env.HMAC_SECRET?.trim();
  if (!secret) {
    throw new Error("HMAC_SECRET is required before hashing client IP addresses.");
  }
  return secret;
}

export function extractAndHashClientIp(req: HttpRequest): string {
  const rawIp =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-client-ip")?.trim() ||
    req.headers.get("host")?.trim() ||
    "unknown";
  const ip = createHmac("sha256", getHmacSecret()).update(rawIp).digest("hex");
  return ip;
}
