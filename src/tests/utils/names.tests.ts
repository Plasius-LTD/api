import { describe, expect, it } from "vitest";
import { splitDisplayName } from "../../utils/names.js";

describe("splitDisplayName", () => {
  it("handles single names", () => {
    expect(splitDisplayName("Plato")).toEqual({
      firstName: "Plato",
      middleName: "",
      lastName: "",
    });
  });

  it("splits two-part names", () => {
    expect(splitDisplayName("Ada Lovelace")).toEqual({
      firstName: "Ada",
      middleName: "",
      lastName: "Lovelace",
    });
  });

  it("captures multi-part middle names", () => {
    expect(splitDisplayName("Mary Jane Watson Parker")).toEqual({
      firstName: "Mary",
      middleName: "Jane Watson",
      lastName: "Parker",
    });
  });

  it("normalizes extra whitespace", () => {
    expect(splitDisplayName("  Jean   Luc  Picard ")).toEqual({
      firstName: "Jean",
      middleName: "Luc",
      lastName: "Picard",
    });
  });
});
