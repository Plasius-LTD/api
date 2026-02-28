import { HttpRequest } from "@azure/functions";
import { createHmac } from "crypto";

const HMAC_SECRET =
  process.env.HMAC_SECRET || "OuYDwS9zpItZ9d84mIuZ+rzU6c9abFkzDWzXAPk4elg="; // Replace for production

export function extractAndHashClientIp(req: HttpRequest): string {
  const rawIp =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-client-ip")?.trim() ||
    req.headers.get("host")?.trim() ||
    "unknown";
  const ip = createHmac("sha256", HMAC_SECRET).update(rawIp).digest("hex");
  return ip;
}
