import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";

import { randomUUID } from "crypto";
import { getCookie, getExtraOutputs } from "../utils/index.js";
import { http } from "@azure/functions/types/app.js";

export const withSession: Middleware = async (
  req: HttpRequest,
  context: InvocationContext
) => {
  const cookieHeader = req.headers.get("cookie") ?? "";
  let sessionId = getCookie(req, "sessionId");

  const { cookies } = getExtraOutputs(context);

  if (!sessionId) {
    sessionId = randomUUID();
    const newCookies = [
      ...cookies,
      {
        name: "sessionId",
        value: sessionId,
        path: "/",
        httpOnly: true,
        sameSite: "None",
        secure: true,
      },
    ];
    context.extraOutputs.set("cookies", newCookies);
  }

  context.extraInputs.set("sessionId", sessionId);

  return true;
};
