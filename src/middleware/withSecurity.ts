import type { HttpRequest, InvocationContext } from "@azure/functions";
import type { Middleware } from "./withMiddleware";
import { getExtraOutputs } from "../utils/index.js";
import {
  applyBaselineSecurityHeaders,
  isHttpsRequest,
  isInsecureLocalRequest,
  shouldEnforceHttps,
} from "./transportSecurity.js";
export function withSecurity(): Middleware {
  return async (request: HttpRequest, context: InvocationContext) => {
    const { headers, cookies } = getExtraOutputs(context);

    applyBaselineSecurityHeaders(headers);

    context.extraOutputs.set("headers", headers);

    if (
      shouldEnforceHttps() &&
      !isHttpsRequest(request) &&
      !isInsecureLocalRequest(request)
    ) {
      context.extraOutputs.set("http", {
        status: 426,
        headers,
        cookies,
        body: "HTTPS is required.",
      });
      return Promise.resolve(false);
    }

    return Promise.resolve(true);
  };
}
