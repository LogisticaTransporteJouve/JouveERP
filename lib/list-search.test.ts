import { describe, expect, it } from "vitest";

import { parseSearchTerm } from "./list-search";

describe("parseSearchTerm", () => {
  it("splits numbers from names", () => {
    expect(parseSearchTerm("  123 ")).toEqual({
      numero: 123,
      name: null,
    });
    expect(parseSearchTerm("Acme 2")).toEqual({
      numero: null,
      name: "Acme 2",
    });
    expect(parseSearchTerm("")).toEqual({ numero: null, name: null });
    expect(parseSearchTerm("30714637432").numero).toBe(null);
  });
});
