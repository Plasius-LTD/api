import { HttpRequest } from "@azure/functions";

interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  maxAge?: number; // seconds
  path?: string;
  domain?: string;
}

export function setCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`;

  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  cookie += `; Path=${options.path ?? "/"}`;

  return cookie;
}

export function getCookie(
  request: HttpRequest,
  name: string
): string | undefined {
  const cookies = request.headers.get("cookie") || request.headers.get("Cookie");
  if (!cookies) return undefined;

  const cookiePairs = cookies.split(";").map((c) => c.trim());
  for (const pair of cookiePairs) {
    const [key, ...vals] = pair.split("=");
    if (key === name) return decodeURIComponent(vals.join("="));
  }
  return undefined;
}
