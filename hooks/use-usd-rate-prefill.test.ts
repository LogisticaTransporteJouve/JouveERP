import { describe, expect, it } from "vitest";

import { parseArAmount } from "@/lib/format";

import { usdRatePrefill } from "./use-usd-rate-prefill";

describe("usdRatePrefill", () => {
  it("fills an empty input with the loaded rate, in es-AR", () => {
    expect(usdRatePrefill(1180.5, "", null)).toBe("1.180,50");
    expect(usdRatePrefill(1180, "", null)).toBe("1.180,00");
  });

  it("prefills what parseArAmount reads back as the same rate", () => {
    for (const rate of [1180, 1180.5, 1180.1234]) {
      expect(parseArAmount(usdRatePrefill(rate, "", null) ?? "")).toBe(rate);
    }
  });

  it("refreshes a rate it prefilled when the date brings another", () => {
    expect(usdRatePrefill(1200, "1.180,50", "1.180,50")).toBe("1.200,00");
  });

  it("never overwrites a rate the user typed", () => {
    expect(usdRatePrefill(1200, "1.150", "1.180,50")).toBeNull();
    expect(usdRatePrefill(1200, "1.150", null)).toBeNull();
  });

  it("leaves the input alone while no rate is loaded", () => {
    expect(usdRatePrefill(null, "", null)).toBeNull();
    expect(usdRatePrefill(undefined, "", null)).toBeNull();
  });
});
