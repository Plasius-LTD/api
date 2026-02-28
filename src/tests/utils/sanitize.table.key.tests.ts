import { describe, expect, it } from "vitest";
import { sanitizeUrlForPartitionKey } from "../../utils/sanitize.table.key.js";

describe("sanitizeUrlForPartitionKey", () => {
  it("sanitizes hostnames into safe partition keys", () => {
    expect(
      sanitizeUrlForPartitionKey("https://Example.COM/some/path?query=1")
    ).toBe("example-com");

    expect(sanitizeUrlForPartitionKey("https://sub.domain.example.co.uk")).toBe(
      "sub-domain-example-co-uk"
    );
  });

  it("throws for invalid URLs", () => {
    expect(() => sanitizeUrlForPartitionKey("not a url")).toThrow(
      "Invalid URL passed for sanitization: \"not a url\""
    );
  });
});
