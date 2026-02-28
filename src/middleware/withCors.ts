import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";
import { getExtraOutputs } from "../utils/index.js";

export function withCors(
  allowedOrigins: string[] = ["*"],
  allowedMethods: string[] = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "HEAD",
  ],
  allowedHeaders: string[] = ["Content-Type", "Authorization"]
): Middleware {
  return async (req: HttpRequest, context: InvocationContext) => {
    const logger = context.extraInputs.get("logger") as {
      log: (...args: any[]) => void;
      warn: (...args: any[]) => void;
      error: (...args: any[]) => void;
    };

    const { headers, cookies } = getExtraOutputs(context);
    logger?.log(`[withCors] Executing middleware for ${req.method} ${req.url}`);

    const origin = req.headers.get("origin") ?? "*";
    const isOriginAllowed =
      allowedOrigins.includes("*") || allowedOrigins.includes(origin);

    if (!isOriginAllowed) {
      logger?.warn(`CORS blocked request from origin: ${origin}`);
    }

    headers.set(
      "Access-Control-Allow-Origin",
      isOriginAllowed ? origin : "null"
    );
    headers.set("Access-Control-Allow-Methods", allowedMethods.join(", "));
    headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
    headers.set("Access-Control-Allow-Credentials", "true");
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