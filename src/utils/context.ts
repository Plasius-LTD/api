import { Cookie, InvocationContext } from "@azure/functions";

export function getExtraOutputs(context: InvocationContext): {
  headers: Headers;
  cookies: Cookie[];
} {
  const headers =
    (context.extraOutputs.get("headers") as Headers) || new Headers();
  const cookies = (context.extraOutputs.get("cookies") as Cookie[]) || [];
  return { headers, cookies };
}
