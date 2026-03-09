import type { HttpRequest, InvocationContext } from "@azure/functions";
import { describe, expect, it } from "vitest";
import { withSession } from "../../middleware/withSession.js";

function createRequest(
  url: string,
  headers: Record<string, string> = {}
): HttpRequest {
  return {
    url,
    headers: new Headers(headers),
  } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return {
    extraInputs: new Map<string, unknown>(),
    extraOutputs: new Map<string, unknown>(),
  } as unknown as InvocationContext;
}

describe("withSession middleware", () => {
  it("reuses existing session id when present", async () => {
    const request = createRequest("https://api.example.com/resource", {
      cookie: "sessionId=existing-id",
    });
    const context = createContext();

    const result = await withSession(request, context);

    expect(result).toBe(true);
    expect(context.extraInputs.get("sessionId")).toBe("existing-id");
    expect(context.extraOutputs.get("cookies")).toBeUndefined();
  });

  it("issues a secure session cookie for https requests", async () => {
    const request = createRequest("https://api.example.com/resource");
    const context = createContext();

    const result = await withSession(request, context);
    const sessionId = context.extraInputs.get("sessionId");
    const cookies = context.extraOutputs.get("cookies") as Array<
      Record<string, unknown>
    >;

    expect(result).toBe(true);
    expect(typeof sessionId).toBe("string");
    expect(Array.isArray(cookies)).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: "sessionId",
      value: sessionId,
      path: "/",
      httpOnly: true,
      sameSite: "None",
      secure: true,
    });
  });

  it("issues a localhost-friendly session cookie for insecure local requests", async () => {
    const request = createRequest("http://localhost:7071/api/resource", {
      host: "localhost:7071",
    });
    const context = createContext();

    const result = await withSession(request, context);
    const sessionId = context.extraInputs.get("sessionId");
    const cookies = context.extraOutputs.get("cookies") as Array<
      Record<string, unknown>
    >;

    expect(result).toBe(true);
    expect(typeof sessionId).toBe("string");
    expect(Array.isArray(cookies)).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: "sessionId",
      value: sessionId,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    });
  });
});
