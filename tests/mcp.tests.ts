// tests/mcp.test.ts
import { describe, it, expect } from "vitest";
import { aiPluginJson } from "../src/functions/mcp/ai-plugin.js";
import { contextHandler } from "../src/functions/mcp/context.js";
import { actionsHandler } from "../src/functions/mcp/actions.js";
import { schemaHandler } from "../src/functions/mcp/schema.js";

// Mocks
const dummyRequest = {} as any;
const dummyContext = {
  log: () => {},
} as any;

describe("MCP AI Plugin JSON", () => {
  it("returns valid plugin manifest JSON", async () => {
    const res = await aiPluginJson(dummyRequest, dummyContext);
    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");

    const body = JSON.parse(res.body as string);
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("description");
    expect(body).toHaveProperty("context_url");
    expect(body).toHaveProperty("actions_url");
    expect(body).toHaveProperty("schema_url");
  });
});

describe("MCP Context Endpoint", () => {
  it("returns valid context object", async () => {
    const res = await contextHandler(dummyRequest, dummyContext);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("user");
    expect(body).toHaveProperty("page");
  });
});

describe("MCP Actions Endpoint", () => {
  it("returns valid actions array", async () => {
    const res = await actionsHandler(dummyRequest, dummyContext);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.actions).toBeInstanceOf(Array);
    expect(body.actions[0]).toHaveProperty("name");
    expect(body.actions[0]).toHaveProperty("parameters");
  });
});

describe("MCP Schema Endpoint", () => {
  it("returns schema object with definitions", async () => {
    const res = await schemaHandler(dummyRequest, dummyContext);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("Post");
    expect(body.Post).toHaveProperty("title");
  });
});
