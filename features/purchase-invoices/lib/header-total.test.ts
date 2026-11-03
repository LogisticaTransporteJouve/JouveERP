import { describe, expect, it } from "vitest";

import { followHeaderTotal } from "./header-total";

describe("followHeaderTotal", () => {
  it("fills an empty total", () => {
    expect(followHeaderTotal(0, null, 121)).toBe(121);
  });

  it("follows a total that still equals the previous sum", () => {
    expect(followHeaderTotal(121, 121, 161)).toBe(161);
  });

  it("drops a hidden exento from a total it had derived", () => {
    expect(followHeaderTotal(161, 161, 121)).toBe(121);
  });

  it("keeps a total the user typed", () => {
    expect(followHeaderTotal(130, 121, 161)).toBeNull();
  });

  it("keeps a stored total on the first calculation of an edit", () => {
    expect(followHeaderTotal(130, null, 121)).toBeNull();
  });
});
