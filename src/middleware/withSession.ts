import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";

import { ensureSession, getCookieSecurity, getExtraOutputs } from "../utils/index.js";

export const withSession: Middleware = async (
  req: HttpRequest,
  context: InvocationContext
) => {
  const { cookies } = getExtraOutputs(context);
  const session = ensureSession(req, {
    cookieOptions: getCookieSecurity(req),
  });

  if (session.isNew && session.cookie) {
    const newCookies = [...cookies, session.cookie];
    context.extraOutputs.set("cookies", newCookies);
  }

  context.extraInputs.set("sessionId", session.sessionId);

  return true;
};
