import { describe, expect, it } from "vitest";

import { nextFreightPrefill } from "./freight-prefill";

describe("nextFreightPrefill", () => {
  it("fills an empty field with the tariff", () => {
    expect(
      nextFreightPrefill({
        current: "",
        dirty: false,
        lastAuto: null,
        suggested: 1000,
      }),
    ).toBe("1000");
  });

  it("empties the previous client's tariff when the new one has none", () => {
    expect(
      nextFreightPrefill({
        current: "1000",
        dirty: false,
        lastAuto: "1000",
        suggested: null,
      }),
    ).toBe("");
  });

  it("moves a prefilled flete to the new client's or date's tariff", () => {
    expect(
      nextFreightPrefill({
        current: "1000",
        dirty: false,
        lastAuto: "1000",
        suggested: 1500,
      }),
    ).toBe("1500");
  });

  it("keeps a flete the user typed", () => {
    expect(
      nextFreightPrefill({
        current: "800",
        dirty: true,
        lastAuto: "1000",
        suggested: null,
      }),
    ).toBeNull();
    expect(
      nextFreightPrefill({
        current: "800",
        dirty: false,
        lastAuto: "1000",
        suggested: 1500,
      }),
    ).toBeNull();
  });

  it("does nothing when the field already shows the tariff", () => {
    expect(
      nextFreightPrefill({
        current: "1000",
        dirty: false,
        lastAuto: "1000",
        suggested: 1000,
      }),
    ).toBeNull();
  });
});
