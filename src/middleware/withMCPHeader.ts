import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";
import {
  apiErrorTranslationKeys,
  createApiErrorBody,
} from "../utils/error-messages.js";

export const withMCPHeader: Middleware = async (
  req: HttpRequest,
  context: InvocationContext
) => {
  const modelHeader = req.headers.get("x-mcp-model");
  if (!modelHeader) {
    context.extraOutputs.set("response", {
      status: 400,
      body: createApiErrorBody(apiErrorTranslationKeys.mcpModelHeaderMissing),
    });
    return false;
  }
  // Could add more validation or parsing here
  return true;
};
