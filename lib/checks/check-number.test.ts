import { describe, expect, it } from "vitest";

import { checkNumberKey } from "./check-number";

describe("checkNumberKey", () => {
  it("ignores padding and separators", () => {
    expect(checkNumberKey("00012345")).toBe("12345");
    expect(checkNumberKey("Q 12-345")).toBe("12345");
    expect(checkNumberKey("12345")).toBe(checkNumberKey("0012345"));
  });
});
