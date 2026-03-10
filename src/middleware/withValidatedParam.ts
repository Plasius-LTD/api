import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getExtraOutputs } from "../utils/index.js";
import type { Middleware } from "./withMiddleware.js";

export type ParamValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function withValidatedParam<T>(options: {
  paramName: string;
  validate: (rawValue: unknown) => ParamValidationResult<T>;
  contextKey?: string;
  createErrorResponse?: (error: string) => HttpResponseInit;
}): Middleware {
  const contextKey = options.contextKey ?? `validated:${options.paramName}`;

  return async function validatedParamMiddleware(
    req: HttpRequest,
    context: InvocationContext
  ): Promise<boolean> {
    const result = options.validate(req.params?.[options.paramName]);
    if (!result.ok) {
      const { headers, cookies } = getExtraOutputs(context);
      context.extraOutputs.set("http", {
        status: 400,
        headers,
        cookies,
        jsonBody: {
          error: result.error,
        },
        ...options.createErrorResponse?.(result.error),
      });
      return false;
    }

    context.extraInputs.set(contextKey, result.value);
    return true;
  };
}
