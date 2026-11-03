import { describe, expect, it } from "vitest";

import { containsPattern } from "./like-pattern";

describe("containsPattern", () => {
  it("escapes LIKE wildcards in a search", () => {
    expect(containsPattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
    expect(containsPattern("a*b")).toBe("%a_b%");
  });
});
