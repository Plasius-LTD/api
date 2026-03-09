import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as middlewareExports from "../../middleware/index.js";
import { withCors } from "../../middleware/withCors.js";
import { withCSRF } from "../../middleware/withCSRF.js";
import { withDefaultMiddleware } from "../../middleware/withDefaultMiddleware.js";
import { withLogging } from "../../middleware/withLogging.js";
import { withMCPHeader } from "../../middleware/withMCPHeader.js";
import { withMiddleware } from "../../middleware/withMiddleware.js";
import { withSecurity } from "../../middleware/withSecurity.js";
import { withSession } from "../../middleware/withSession.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ENFORCE_HTTPS = process.env.ENFORCE_HTTPS;

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

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ENFORCE_HTTPS === undefined) {
    delete process.env.ENFORCE_HTTPS;
  } else {
    process.env.ENFORCE_HTTPS = ORIGINAL_ENFORCE_HTTPS;
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

  it("skips csrf validation for the refresh-token route", async () => {
    const context = createContext();
    const request = createRequest("POST", "https://api.example.com/api/oauth/refresh-token");

    const shouldContinue = await withCSRF()(request, context);

    expect(shouldContinue).toBe(true);
    expect(context.extraOutputs.get("http")).toBeUndefined();
  });

  it("skips csrf validation for normalized refresh-token route variants", async () => {
    const context = createContext();
    const request = createRequest(
      "POST",
      "https://api.example.com/proxy/api/oauth/refresh-token/",
    );

    const shouldContinue = await withCSRF()(request, context);

    expect(shouldContinue).toBe(true);
    expect(context.extraOutputs.get("http")).toBeUndefined();
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
    const request = createRequest("PATCH", "https://api.example.com/users/1");

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
      expect.stringContaining("PATCH https://api.example.com/users/1 one")
    );
    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining("PATCH https://api.example.com/users/1 two")
    );
    expect(context.error).toHaveBeenCalledWith(
      expect.stringContaining("PATCH https://api.example.com/users/1 three")
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
