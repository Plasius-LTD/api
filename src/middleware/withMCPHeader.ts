import { HttpRequest, InvocationContext } from "@azure/functions";
import { Middleware } from "./withMiddleware.js";

export const withMCPHeader: Middleware = async (
  req: HttpRequest,
  context: InvocationContext
) => {
  const modelHeader = req.headers.get("x-mcp-model");
  if (!modelHeader) {
    context.extraOutputs.set("response", {
      status: 400,
      body: { error: "Missing x-mcp-model header" },
    });
    return false;
  }
  // Could add more validation or parsing here
  return true;
};
