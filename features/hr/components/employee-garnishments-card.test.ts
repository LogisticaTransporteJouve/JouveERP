import { describe, expect, it } from "vitest";

import { withGarnishmentMode } from "./employee-garnishments-card";

type Draft = Parameters<typeof withGarnishmentMode>[0];

const DRAFT: Draft = {
  mode: "fixed",
  value: "1.500",
  active_from: "2026-11-01",
  active_to: "",
  beneficiary: "",
  court_note: "",
};

describe("withGarnishmentMode", () => {
  it("clears the value so 1.500 pesos never becomes 1.5 %", () => {
    expect(withGarnishmentMode(DRAFT, "percentage")).toMatchObject({
      mode: "percentage",
      value: "",
    });
  });

  it("keeps the value when the mode does not change", () => {
    expect(withGarnishmentMode(DRAFT, "fixed")).toBe(DRAFT);
  });
});
