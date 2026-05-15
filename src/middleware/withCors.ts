import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";
import { getExtraOutputs } from "../utils/index.js";

export interface CorsOptions {
  allowCredentials?: boolean;
}

export function withCors(
  allowedOrigins: string[] = [],
  allowedMethods: string[] = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "HEAD",
  ],
  allowedHeaders: string[] = ["Content-Type", "Authorization"],
  options: CorsOptions = {}
): Middleware {
  return async (req: HttpRequest, context: InvocationContext) => {
    const logger = context.extraInputs.get("logger") as {
      log: (...args: any[]) => void;
      warn: (...args: any[]) => void;
      error: (...args: any[]) => void;
    };

    const { headers, cookies } = getExtraOutputs(context);
    logger?.log(`[withCors] Executing middleware for ${req.method} ${req.url}`);

    const origin = req.headers.get("origin");
    const allowCredentials = options.allowCredentials ?? true;
    const hasWildcardOrigin = allowedOrigins.includes("*");
    const isSpecificOriginAllowed =
      origin !== null && allowedOrigins.includes(origin);
    const isOriginAllowed = hasWildcardOrigin
      ? !allowCredentials
      : isSpecificOriginAllowed;

    if (!isOriginAllowed) {
      logger?.warn(`CORS blocked request from origin: ${origin ?? "none"}`);
    }

    const allowOrigin = hasWildcardOrigin && !allowCredentials
      ? "*"
      : isSpecificOriginAllowed
        ? origin
        : "null";

    headers.set(
      "Access-Control-Allow-Origin",
      allowOrigin
    );
    headers.set("Access-Control-Allow-Methods", allowedMethods.join(", "));
    headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
    headers.set("Vary", "Origin");
    if (allowCredentials && isSpecificOriginAllowed) {
      headers.set("Access-Control-Allow-Credentials", "true");
    } else {
      headers.delete("Access-Control-Allow-Credentials");
    }
    headers.set("Referrer-Policy", "origin-when-cross-origin");

    context.extraOutputs.set("headers", headers);

    if (req.method === "OPTIONS") {
      logger?.log("CORS preflight request received. Returning early with 204.");
      context.extraOutputs.set("http", {
        status: 204,
        headers,
        cookies,
      });
      return false;
    }

    return true;
  };
}
