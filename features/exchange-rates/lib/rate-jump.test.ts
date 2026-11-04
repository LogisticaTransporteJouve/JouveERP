import { describe, expect, it } from "vitest";

import { rateJumpWarning } from "./rate-jump";

const r = (rate_date: string, rate: number, currency = "USD") => ({
  currency,
  rate_date,
  rate,
});

describe("rateJumpWarning", () => {
  const rates = [r("2026-09-30", 1450), r("2025-01-10", 1000)];

  it("compares with the nearest rate on or before the date", () => {
    expect(rateJumpWarning(rates, "2026-10-01", 1_450_125)).toMatch(
      /La última cotización fue 1\.450,00 \(30 \S+ 2026\)/,
    );
    expect(rateJumpWarning(rates, "2026-10-01", 1500)).toBeNull();
    // An older day is compared with the rate of its own time.
    expect(rateJumpWarning(rates, "2025-02-01", 1050)).toBeNull();
  });

  it("uses the nearest later rate when none is earlier", () => {
    expect(rateJumpWarning(rates, "2024-12-01", 1100)).toBeNull();
    expect(rateJumpWarning(rates, "2024-12-01", 100)).toMatch(
      /La siguiente cotización es 1\.000,00/,
    );
  });

  it("asks at more than 30%, in either direction", () => {
    expect(rateJumpWarning(rates, "2026-10-01", 1450 * 1.3)).toBeNull();
    expect(rateJumpWarning(rates, "2026-10-01", 1450 * 1.31)).not.toBeNull();
    expect(rateJumpWarning(rates, "2026-10-01", 1450 * 0.69)).not.toBeNull();
  });

  it("says nothing with no stored USD rate", () => {
    expect(rateJumpWarning([], "2026-10-01", 1_450_125)).toBeNull();
    expect(
      rateJumpWarning([r("2026-09-30", 1, "EUR")], "2026-10-01", 1450),
    ).toBeNull();
  });
});
