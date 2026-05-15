import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";
import { resolveRequestPath } from "../utils/index.js";

export const withLogging: Middleware = async (
  req: HttpRequest,
  context: InvocationContext
) => {
  const method = req.method;
  const path = resolveRequestPath(req.url);

  const prefix = `${method} ${path} `;

  function makeLogger(context: InvocationContext) {
    return {
      log: (...args: any[]) =>
        context.log(
          ...args.map((arg) => (typeof arg === "string" ? prefix + arg : arg))
        ),
      warn: (...args: any[]) =>
        context.warn(
          ...args.map((arg) => (typeof arg === "string" ? prefix + arg : arg))
        ),
      error: (...args: any[]) =>
        context.error(
          ...args.map((arg) => (typeof arg === "string" ? prefix + arg : arg))
        ),
    };
  }

  context.extraInputs.set("logger", makeLogger(context));

  return true;
};
