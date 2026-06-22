import { describe, expect, it } from "vitest";

import { computeStorageBilling } from "./billing";

const names = new Map([
  ["c1", "Acme"],
  ["c2", "Beta"],
]);

describe("computeStorageBilling", () => {
  it("charges inclusive days × monthly rate prorated /30", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-07-01",
          exit_date: "2026-07-10", // 10 inclusive days
        },
      ],
      tariffs: [
        {
          client_id: "c1",
          rate_per_pallet: 3000, // monthly → 100/day
          period: "monthly",
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.lines[0]?.days).toBe(10);
    expect(r.lines[0]?.daily_rate).toBe(100);
    expect(r.lines[0]?.charge).toBe(1000);
    expect(r.total).toBe(1000);
  });

  it("clips storage to the billing period and treats null exit as still-stored", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-06-20",
          exit_date: null, // still stored → clipped to periodEnd
        },
      ],
      tariffs: [
        {
          client_id: null,
          rate_per_pallet: 31, // daily
          period: "daily",
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31", // 31 inclusive days
    });
    expect(r.lines[0]?.days).toBe(31);
    expect(r.total).toBe(31 * 31);
  });

  it("prefers the client-specific tariff over the general one", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-07-01",
          exit_date: "2026-07-01", // 1 day
        },
      ],
      tariffs: [
        {
          client_id: null,
          rate_per_pallet: 50,
          period: "daily",
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
        {
          client_id: "c1",
          rate_per_pallet: 10,
          period: "daily",
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.lines[0]?.charge).toBe(10);
  });

  it("flags pallets without an applicable tariff (charge 0)", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c2",
          code: "P-1",
          entry_date: "2026-07-01",
          exit_date: "2026-07-05",
        },
      ],
      tariffs: [], // none
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.pallets_without_tariff).toBe(1);
    expect(r.lines[0]?.charge).toBe(0);
    expect(r.lines[0]?.has_tariff).toBe(false);
  });
});
