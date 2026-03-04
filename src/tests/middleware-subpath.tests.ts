import { describe, expect, it } from "vitest";
import * as middlewareModule from "../middleware/index.js";

describe("middleware subpath source surface", () => {
  it("exports middleware primitives from middleware index", () => {
    expect(typeof middlewareModule.withMiddleware).toBe("function");
    expect(typeof middlewareModule.withCors).toBe("function");
    expect(typeof middlewareModule.withCSRF).toBe("function");
    expect(typeof middlewareModule.withSession).toBe("function");
    expect(typeof middlewareModule.withRateLimiting).toBe("function");
    expect(typeof middlewareModule.withSecurity).toBe("function");
    expect(typeof middlewareModule.withDefaultMiddleware).toBe("function");
    expect(typeof middlewareModule.withMCPHeader).toBe("function");
  });
});
