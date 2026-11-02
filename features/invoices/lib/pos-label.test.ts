import { describe, expect, it } from "vitest";

import { posLabel } from "./pos-label";

describe("posLabel", () => {
  it("pads the number and adds the nickname when there is one", () => {
    expect(posLabel({ numero: 3, nickname: "Casa central" })).toBe(
      "0003 · Casa central",
    );
    expect(posLabel({ numero: 12, nickname: null })).toBe("0012");
  });
});
