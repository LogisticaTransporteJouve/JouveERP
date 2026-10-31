import { describe, expect, it } from "vitest";

import { usdRatePrefill } from "./use-usd-rate-prefill";

describe("usdRatePrefill", () => {
  it("fills an empty input with the loaded rate", () => {
    expect(usdRatePrefill(1180.5, "", null)).toBe("1180.5");
  });

  it("refreshes a rate it prefilled when the date brings another", () => {
    expect(usdRatePrefill(1200, "1180.5", "1180.5")).toBe("1200");
  });

  it("never overwrites a rate the user typed", () => {
    expect(usdRatePrefill(1200, "1150", "1180.5")).toBeNull();
    expect(usdRatePrefill(1200, "1150", null)).toBeNull();
  });

  it("leaves the input alone while no rate is loaded", () => {
    expect(usdRatePrefill(null, "", null)).toBeNull();
    expect(usdRatePrefill(undefined, "", null)).toBeNull();
  });
});
