import { describe, it, expect } from "vitest";
import { McpAction } from "../src/types/index.js";

const BASE_URL = "http://127.0.0.1:7071"; // Assumes Azure Functions is running locally

describe("E2E: MCP Endpoints", () => {
  it("should serve a valid ai-plugin.json manifest", async () => {
    const res = await fetch(`${BASE_URL}/.well-known/ai-plugin.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("description");
    expect(body).toHaveProperty("context_url");
    expect(body).toHaveProperty("actions_url");
    expect(body).toHaveProperty("schema_url");
  });

  it("should serve valid context", async () => {
    const res = await fetch(`${BASE_URL}/api/mcp/context`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("user");
    expect(body).toHaveProperty("page");
  });

  it("should serve valid actions", async () => {
    const res = await fetch(`${BASE_URL}/api/mcp/actions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: McpAction[] };
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.actions[0]).toHaveProperty("name");
  });

  it("should serve valid schema", async () => {
    const res = await fetch(`${BASE_URL}/api/mcp/schema`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { Post: { title: string } };
    expect(body).toHaveProperty("Post");
    expect(body.Post).toHaveProperty("title");
  });
});
