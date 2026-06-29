import { describe, expect, it } from "vitest";

import { storedDays } from "./pallet-days";

describe("storedDays", () => {
  it("counts inclusive days from entry to exit", () => {
    expect(storedDays("2026-07-01", "2026-07-10", "2026-07-31")).toBe(10);
  });

  it("counts up to asOf (today) while still in deposit", () => {
    expect(storedDays("2026-07-01", null, "2026-07-15")).toBe(15);
  });

  it("is 1 for a same-day entry/exit", () => {
    expect(storedDays("2026-07-05", "2026-07-05", "2026-07-31")).toBe(1);
  });

  it("is 0 when exit precedes entry", () => {
    expect(storedDays("2026-07-10", "2026-07-05", "2026-07-31")).toBe(0);
  });
});
