import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as middlewareExports from "../../middleware/index.js";
import { withCors } from "../../middleware/withCors.js";
import { withCSRF } from "../../middleware/withCSRF.js";
import { withDefaultMiddleware } from "../../middleware/withDefaultMiddleware.js";
import { withLogging } from "../../middleware/withLogging.js";
import { withMCPHeader } from "../../middleware/withMCPHeader.js";
import { withMiddleware } from "../../middleware/withMiddleware.js";
import { withSecurity } from "../../middleware/withSecurity.js";
import { withSession } from "../../middleware/withSession.js";
import { withValidatedParam } from "../../middleware/withValidatedParam.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ENFORCE_HTTPS = process.env.ENFORCE_HTTPS;
const ORIGINAL_HMAC_SECRET = process.env.HMAC_SECRET;
const ORIGINAL_CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS;
const ORIGINAL_AUTH_COOKIE_SAME_SITE = process.env.AUTH_COOKIE_SAME_SITE;
const ORIGINAL_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const ORIGINAL_TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS;

function createContext(): InvocationContext {
  const context = {
    extraInputs: new Map<string, unknown>(),
    extraOutputs: new Map<string, unknown>(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as InvocationContext;

  context.extraInputs.set("logger", {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  return context;
}

function createRequest(
  method = "GET",
  url = "https://api.example.com/resource",
  headers: Record<string, string> = {}
): HttpRequest {
  return {
    method,
    url,
    headers: new Headers(headers),
  } as unknown as HttpRequest;
}

beforeEach(() => {
  process.env.HMAC_SECRET = "test-hmac-secret";
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ENFORCE_HTTPS === undefined) {
    delete process.env.ENFORCE_HTTPS;
  } else {
    process.env.ENFORCE_HTTPS = ORIGINAL_ENFORCE_HTTPS;
  }
  if (ORIGINAL_HMAC_SECRET === undefined) {
    delete process.env.HMAC_SECRET;
  } else {
    process.env.HMAC_SECRET = ORIGINAL_HMAC_SECRET;
  }
  if (ORIGINAL_CORS_ALLOWED_ORIGINS === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = ORIGINAL_CORS_ALLOWED_ORIGINS;
  }
  if (ORIGINAL_AUTH_COOKIE_SAME_SITE === undefined) {
    delete process.env.AUTH_COOKIE_SAME_SITE;
  } else {
    process.env.AUTH_COOKIE_SAME_SITE = ORIGINAL_AUTH_COOKIE_SAME_SITE;
  }
  if (ORIGINAL_PUBLIC_BASE_URL === undefined) {
    delete process.env.PUBLIC_BASE_URL;
  } else {
    process.env.PUBLIC_BASE_URL = ORIGINAL_PUBLIC_BASE_URL;
  }
  if (ORIGINAL_TRUST_PROXY_HEADERS === undefined) {
    delete process.env.TRUST_PROXY_HEADERS;
  } else {
    process.env.TRUST_PROXY_HEADERS = ORIGINAL_TRUST_PROXY_HEADERS;
  }
  vi.restoreAllMocks();
});

describe("middleware exports", () => {
  it("exposes the public middleware surface from index", () => {
    expect(typeof middlewareExports.withMiddleware).toBe("function");
    expect(typeof middlewareExports.withDefaultMiddleware).toBe("function");
    expect(typeof middlewareExports.withSecurity).toBe("function");
    expect(typeof middlewareExports.withCSRF).toBe("function");
    expect(typeof middlewareExports.withSession).toBe("function");
  });
});

describe("withCors", () => {
  it("handles preflight OPTIONS requests and short-circuits", async () => {
    const middleware = withCors(["https://allowed.example"]);
    const context = createContext();
    const request = createRequest("OPTIONS", "https://api.example.com/resource", {
      origin: "https://allowed.example",
    });

    const shouldContinue = await middleware(request, context);
    const http = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(http.status).toBe(204);
    expect((http.headers as Headers).get("Access-Control-Allow-Origin")).toBe(
      "https://allowed.example"
    );
  });

  it("marks disallowed origins as null and continues", async () => {
    const middleware = withCors(["https://allowed.example"]);
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource", {
      origin: "https://blocked.example",
    });

    const shouldContinue = await middleware(request, context);
    const headers = context.extraOutputs.get("headers") as Headers;

    expect(shouldContinue).toBe(true);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("null");
    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not reflect wildcard origins when credentials are enabled", async () => {
    const middleware = withCors(["*"]);
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource", {
      origin: "https://attacker.example",
    });

    const shouldContinue = await middleware(request, context);
    const headers = context.extraOutputs.get("headers") as Headers;

    expect(shouldContinue).toBe(true);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("null");
    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("allows public wildcard CORS only when credentials are disabled", async () => {
    const middleware = withCors(["*"], undefined, undefined, {
      allowCredentials: false,
    });
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource", {
      origin: "https://public.example",
    });

    const shouldContinue = await middleware(request, context);
    const headers = context.extraOutputs.get("headers") as Headers;

    expect(shouldContinue).toBe(true);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("withCSRF", () => {
  it("issues a csrf cookie for read-only requests when missing", async () => {
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource");

    const shouldContinue = await withCSRF()(request, context);
    const cookies = context.extraOutputs.get("cookies") as Array<Record<string, unknown>>;

    expect(shouldContinue).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: "csrf-token",
      value: expect.any(String),
      secure: true,
      sameSite: "Lax",
    });
  });

  it("issues a localhost-friendly csrf cookie for insecure local requests", async () => {
    const context = createContext();
    const request = createRequest("GET", "http://localhost:7071/resource", {
      host: "localhost:7071",
    });

    const shouldContinue = await withCSRF()(request, context);
    const cookies = context.extraOutputs.get("cookies") as Array<Record<string, unknown>>;

    expect(shouldContinue).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: "csrf-token",
      value: expect.any(String),
      secure: false,
      sameSite: "Lax",
    });
  });

  it("allows explicit cross-site csrf cookies only when configured on https", async () => {
    process.env.AUTH_COOKIE_SAME_SITE = "None";
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource", {
      origin: "http://attacker.example",
      "x-forwarded-proto": "http",
      "x-forwarded-host": "attacker.example",
    });

    const shouldContinue = await withCSRF()(request, context);
    const cookies = context.extraOutputs.get("cookies") as Array<Record<string, unknown>>;

    expect(shouldContinue).toBe(true);
    expect(cookies[0]).toMatchObject({
      secure: true,
      sameSite: "None",
    });
  });

  it("blocks write requests with a missing or mismatched token", async () => {
    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/resource", {
      cookie: "csrf-token=from-cookie",
      "x-csrf-token": "from-header-mismatch",
    });

    const shouldContinue = await withCSRF()(request, context);
    const http = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(http.status).toBe(403);
  });

  it("allows write requests when csrf header and cookie match", async () => {
    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/resource", {
      cookie: "csrf-token=token-123",
      "x-csrf-token": "token-123",
    });

    const shouldContinue = await withCSRF()(request, context);

    expect(shouldContinue).toBe(true);
    expect(context.extraOutputs.get("http")).toBeUndefined();
  });

  it("blocks refresh-token writes without csrf validation", async () => {
    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/api/oauth/refresh-token");

    const shouldContinue = await withCSRF()(request, context);
    const http = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(http.status).toBe(403);
  });

  it("blocks normalized refresh-token route variants without csrf validation", async () => {
    const context = createContext();
    const request = createRequest(
      "POST",
      "https://api.example.com/proxy/api/oauth/refresh-token/",
    );

    const shouldContinue = await withCSRF()(request, context);
    const http = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(http.status).toBe(403);
  });
});

describe("withSecurity", () => {
  it("applies baseline security headers and allows secure/local requests", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.ENFORCE_HTTPS;

    const context = createContext();
    const request = createRequest("GET", "http://localhost:7071/api/resource", {
      host: "localhost:7071",
    });

    const shouldContinue = await withSecurity()(request, context);
    const headers = context.extraOutputs.get("headers") as Headers;

    expect(shouldContinue).toBe(true);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("rejects insecure non-local requests when https is enforced", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENFORCE_HTTPS = "true";

    const context = createContext();
    const request = createRequest("GET", "http://api.example.com/resource", {
      host: "api.example.com",
    });

    const shouldContinue = await withSecurity()(request, context);
    const http = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(http.status).toBe(426);
  });
});

describe("withLogging", () => {
  it("injects prefixed logger helpers into context", async () => {
    const context = createContext();
    const request = createRequest("PATCH", "https://api.example.com/users/1?token=secret");

    const shouldContinue = await withLogging(request, context);
    const logger = context.extraInputs.get("logger") as {
      log: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };

    logger.log("one");
    logger.warn("two");
    logger.error("three");

    expect(shouldContinue).toBe(true);
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining("PATCH /users/1 one")
    );
    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining("PATCH /users/1 two")
    );
    expect(context.error).toHaveBeenCalledWith(
      expect.stringContaining("PATCH /users/1 three")
    );
    expect(context.log).not.toHaveBeenCalledWith(
      expect.stringContaining("token=secret")
    );
  });
});

describe("withMCPHeader", () => {
  it("rejects requests missing x-mcp-model", async () => {
    const context = createContext();
    const request = createRequest("GET");

    const shouldContinue = await withMCPHeader(request, context);
    const response = context.extraOutputs.get("response") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(response.status).toBe(400);
  });

  it("allows requests that provide x-mcp-model", async () => {
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource", {
      "x-mcp-model": "gpt-5-mini",
    });

    const shouldContinue = await withMCPHeader(request, context);

    expect(shouldContinue).toBe(true);
  });
});

describe("withDefaultMiddleware", () => {
  it("returns the standard middleware stack in expected order", () => {
    const stack = withDefaultMiddleware();

    expect(stack).toHaveLength(5);
    expect(stack.at(-1)).toBe(withSession);
    expect(stack.every((mw) => typeof mw === "function")).toBe(true);
  });

  it("uses configured origins and excludes forbidden request headers", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example";
    const stack = withDefaultMiddleware();
    const cors = stack[2];
    const context = createContext();
    const request = createRequest("OPTIONS", "https://api.example.com/resource", {
      origin: "https://app.example",
    });

    const shouldContinue = await cors(request, context);
    const http = context.extraOutputs.get("http") as HttpResponseInit;
    const headers = http.headers as Headers;
    const allowedHeaders = headers.get("Access-Control-Allow-Headers") ?? "";

    expect(shouldContinue).toBe(false);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(allowedHeaders).not.toContain("Cookie");
    expect(allowedHeaders).not.toContain("Set-Cookie");
    expect(allowedHeaders).not.toContain("X-Forwarded-For");
  });
});

describe("withValidatedParam", () => {
  it("stores the normalized value in context when validation passes", async () => {
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource");
    request.params = { id: "User-1 " };

    const shouldContinue = await withValidatedParam({
      paramName: "id",
      validate: (rawValue) => ({
        ok: true,
        value: String(rawValue).trim().toLowerCase(),
      }),
    })(request, context);

    expect(shouldContinue).toBe(true);
    expect(context.extraInputs.get("validated:id")).toBe("user-1");
  });

  it("short-circuits with a 400 response when validation fails", async () => {
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource");
    request.params = { id: "bad<script>" };

    const shouldContinue = await withValidatedParam({
      paramName: "id",
      validate: () => ({
        ok: false,
        error: "Invalid id",
      }),
    })(request, context);
    const response = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: "Invalid id" });
  });

  it("allows callers to override the default error response", async () => {
    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource");
    request.params = { id: "" };

    const shouldContinue = await withValidatedParam({
      paramName: "id",
      validate: () => ({
        ok: false,
        error: "Missing id",
      }),
      createErrorResponse: (error) => ({
        status: 422,
        body: JSON.stringify({ message: error }),
      }),
    })(request, context);
    const response = context.extraOutputs.get("http") as HttpResponseInit;

    expect(shouldContinue).toBe(false);
    expect(response.status).toBe(422);
    expect(response.body).toBe(JSON.stringify({ message: "Missing id" }));
  });
});

describe("withMiddleware", () => {
  it("runs middleware chain and handler, then emits duration log", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.ENFORCE_HTTPS;

    const context = createContext();
    const request = createRequest("GET", "https://api.example.com/resource");
    const handler = vi.fn().mockResolvedValue({ status: 200, body: "ok" });
    const first = vi.fn().mockResolvedValue(true);
    const second = vi.fn().mockResolvedValue(true);

    const wrapped = withMiddleware(handler, [first, second]);
    const response = await wrapped(request, context);

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(request, context);
    expect(response).toMatchObject({ status: 200, body: "ok" });
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining("Handled GET"));
  });

  it("returns middleware-provided response when chain aborts", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.ENFORCE_HTTPS;

    const context = createContext();
    context.extraOutputs.set("http", { status: 401, body: "blocked" });
    const request = createRequest("GET", "https://api.example.com/resource");
    const handler = vi.fn().mockResolvedValue({ status: 200 });
    const blocker = vi.fn().mockResolvedValue(false);

    const wrapped = withMiddleware(handler, [blocker]);
    const response = await wrapped(request, context);

    expect(response).toMatchObject({ status: 401, body: "blocked" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects insecure transport before middleware execution when enforcement is enabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENFORCE_HTTPS = "true";

    const context = createContext();
    const request = createRequest("GET", "http://api.example.com/resource", {
      host: "api.example.com",
    });
    const handler = vi.fn().mockResolvedValue({ status: 200 });
    const mw = vi.fn().mockResolvedValue(true);

    const wrapped = withMiddleware(handler, [mw]);
    const response = await wrapped(request, context);

    expect(response).toMatchObject({ status: 426, body: "HTTPS is required." });
    expect(mw).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
