import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { createHmac } from "crypto";
const HMAC_SECRET = process.env.HMAC_SECRET ?? "default-secret"; // Replace in production
import { withLogging } from "./withLogging";
import { extractAndHashClientIp, getExtraOutputs } from "../utils/index.js";
import {
  applyBaselineSecurityHeaders,
  isHttpsRequest,
  isInsecureLocalRequest,
  shouldEnforceHttps,
} from "./transportSecurity.js";
export type AzureFunction = (
  req: HttpRequest,
  context: InvocationContext
) => Promise<HttpResponseInit>;

export type Middleware = (
  req: HttpRequest,
  context: InvocationContext
) => Promise<boolean>;

export function withMiddleware(
  handler: AzureFunction,
  middlewares: Middleware[]
): AzureFunction {
  return async function (
    req: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> {
    context.extraInputs.set("fetchData", handler);

    const start = Date.now();
    
    const ip = extractAndHashClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    const method = req.method;
    const path = req.url;

    // Add additional logging context to all context.log/.warn/.error messages
    await withLogging(req, context);

    const { headers, cookies } = getExtraOutputs(context);
    applyBaselineSecurityHeaders(headers);
    context.extraOutputs.set("headers", headers);

    if (
      shouldEnforceHttps() &&
      !isHttpsRequest(req) &&
      !isInsecureLocalRequest(req)
    ) {
      context.log("request rejected: insecure transport in https-enforced mode");
      return {
        status: 426,
        headers,
        cookies,
        body: "HTTPS is required.",
      };
    }

    for (const mw of middlewares) {
      const continueProcessing = await mw(req, context);
      if (!continueProcessing) {
        // Middleware handled response or aborted

        return context.extraOutputs.get("http") as HttpResponseInit;
      }
    }

    const value = await handler(req, context);

    const end = Date.now();
    const duration = end - start;

    context.log(
      `Handled ${method} ${path} | IP: ${ip} | Agent: ${userAgent} | Duration: ${duration}ms`
    );

    return value;
  };
}
