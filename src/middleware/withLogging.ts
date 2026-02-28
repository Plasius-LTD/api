import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";
import { extractAndHashClientIp } from "../utils/index.js";

export const withLogging: Middleware = async (
  req: HttpRequest,
  context: InvocationContext
) => {
  const ip = extractAndHashClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const method = req.method;
  const path = req.url;

  const prefix = `${method} ${path} `; //| IP: ${ip} | Agent: ${userAgent} | `;

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
