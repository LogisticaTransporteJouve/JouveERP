import { describe, expect, it } from "vitest";

import {
  computeStorageBilling,
  type ClientTariffInput,
  type TariffInput,
} from "./billing";

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
          handling_in: 0,
          handling_out: 0,
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientTariffs: [],
      usdRate: null,
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
          handling_in: 0,
          handling_out: 0,
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientTariffs: [],
      usdRate: null,
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
          handling_in: 0,
          handling_out: 0,
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
        {
          client_id: "c1",
          rate_per_pallet: 10,
          period: "daily",
          handling_in: 0,
          handling_out: 0,
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientTariffs: [],
      usdRate: null,
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
      clientTariffs: [],
      usdRate: null,
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.pallets_without_tariff).toBe(1);
    expect(r.lines[0]?.charge).toBe(0);
    expect(r.lines[0]?.has_tariff).toBe(false);
  });

  it("adds carga on entry and descarga on exit within the period", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-07-05",
          exit_date: "2026-07-09", // 5 inclusive days
        },
      ],
      tariffs: [
        {
          client_id: "c1",
          rate_per_pallet: 100,
          period: "daily",
          handling_in: 500,
          handling_out: 300,
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientTariffs: [],
      usdRate: null,
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.lines[0]?.storage_charge).toBe(500); // 5 × 100
    expect(r.lines[0]?.handling_in_charge).toBe(500);
    expect(r.lines[0]?.handling_out_charge).toBe(300);
    expect(r.lines[0]?.charge).toBe(1300);
    expect(r.handling_total).toBe(800);
    expect(r.total).toBe(1300);
  });

  it("skips carga when the pallet entered before the period", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-06-20", // before period
          exit_date: "2026-07-10", // exits within period
        },
      ],
      tariffs: [
        {
          client_id: "c1",
          rate_per_pallet: 10,
          period: "daily",
          handling_in: 500,
          handling_out: 300,
          valid_from: "2026-01-01",
          valid_to: null,
          is_active: true,
        },
      ],
      clientTariffs: [],
      usdRate: null,
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.lines[0]?.handling_in_charge).toBe(0); // entered before period → no carga
    expect(r.lines[0]?.handling_out_charge).toBe(300); // exited within → descarga
  });
});

describe("applied_tariffs snapshot", () => {
  const names = new Map([["c1", "Cliente 1"]]);
  const GENERAL = {
    client_id: null,
    rate_per_pallet: 10,
    period: "daily",
    handling_in: 0,
    handling_out: 0,
    valid_from: "2026-01-01",
    valid_to: null,
    is_active: true,
  };

  it("captures the distinct tariffs actually used", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-07-01",
          exit_date: null,
        },
        {
          id: "p2",
          client_id: "c1",
          code: "P-2",
          entry_date: "2026-07-05",
          exit_date: null,
        },
      ],
      tariffs: [GENERAL],
      clientTariffs: [],
      usdRate: null,
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.applied_tariffs).toHaveLength(1);
    expect(r.applied_tariffs[0]).toMatchObject({
      client_id: null,
      rate_per_pallet: 10,
      period: "daily",
      valid_from: "2026-01-01",
    });
  });

  it("is empty when no tariff applied", () => {
    const r = computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-07-01",
          exit_date: null,
        },
      ],
      tariffs: [],
      clientTariffs: [],
      usdRate: null,
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(r.applied_tariffs).toHaveLength(0);
    expect(r.pallets_without_tariff).toBe(1);
  });
});

describe("client tariffs (roadmap 4.2)", () => {
  // General: 10/day, carga 50, descarga 60.
  const general: TariffInput = {
    client_id: null,
    rate_per_pallet: 10,
    period: "daily",
    handling_in: 50,
    handling_out: 60,
    valid_from: "2026-01-01",
    valid_to: null,
    is_active: true,
  };
  const storage = (
    over: Partial<ClientTariffInput> = {},
  ): ClientTariffInput => ({
    client_id: "c1",
    concept: "storage",
    unit: "pallet_day",
    price: 20,
    currency: "ARS",
    valid_from: "2026-07-11",
    valid_to: null,
    ...over,
  });
  const run = (
    clientTariffs: ClientTariffInput[],
    opts: {
      tariffs?: TariffInput[];
      usdRate?: number | null;
      pallet?: Partial<{
        client_id: string;
        entry_date: string;
        exit_date: string | null;
      }>;
    } = {},
  ) =>
    computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-07-01",
          exit_date: "2026-07-31",
          ...opts.pallet,
        },
      ],
      tariffs: opts.tariffs ?? [general],
      clientTariffs,
      usdRate: opts.usdRate ?? null,
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });

  it("charges the client's tariff on the days it covers and the general on the rest", () => {
    // 1–10 at the general 10/day, 11–31 (21 days) at the client's 20/day.
    const r = run([storage()]);
    expect(r.lines[0]?.storage_charge).toBe(10 * 10 + 21 * 20);
    expect(r.lines[0]?.daily_rate).toBe(round2((100 + 420) / 31));
    expect(r.lines[0]?.has_tariff).toBe(true);
    expect(r.pallets_without_tariff).toBe(0);
  });

  it("prorates a monthly client tariff /30", () => {
    const r = run([
      storage({ unit: "pallet_month", price: 900, valid_from: "2026-01-01" }),
    ]);
    expect(r.lines[0]?.storage_charge).toBe(31 * 30);
  });

  it("splits the period between two consecutive client tariffs", () => {
    const r = run([
      storage({ price: 5, valid_from: "2026-01-01", valid_to: "2026-07-15" }),
      storage({ price: 7, valid_from: "2026-07-16" }),
    ]);
    expect(r.lines[0]?.storage_charge).toBe(15 * 5 + 16 * 7);
  });

  it("takes carga and descarga from the client tariff in force on the entry and exit days", () => {
    const r = run([
      {
        ...storage({ valid_from: "2026-01-01" }),
        concept: "handling_in",
        unit: "pallet",
        price: 500,
      },
      {
        ...storage({ valid_from: "2026-08-01" }),
        concept: "handling_out",
        unit: "pallet",
        price: 900,
      },
    ]);
    expect(r.lines[0]?.handling_in_charge).toBe(500);
    // The descarga tariff starts after the exit: the general one applies.
    expect(r.lines[0]?.handling_out_charge).toBe(60);
  });

  it("ignores another client's tariff", () => {
    const r = run([storage({ client_id: "c2", valid_from: "2026-01-01" })]);
    expect(r.lines[0]?.storage_charge).toBe(31 * 10);
  });

  it("converts a USD tariff at the given rate", () => {
    const r = run(
      [storage({ currency: "USD", price: 2, valid_from: "2026-01-01" })],
      { usdRate: 1000 },
    );
    expect(r.lines[0]?.storage_charge).toBe(31 * 2000);
    expect(r.applied_tariffs).toContainEqual(
      expect.objectContaining({
        source: "client_tariff",
        currency: "USD",
        price: 2,
        usd_rate: 1000,
      }),
    );
  });

  it("flags a USD tariff without a rate instead of billing it at the general", () => {
    const r = run([storage({ currency: "USD", price: 2 })], { usdRate: null });
    // Only the 10 general days are priced.
    expect(r.lines[0]?.storage_charge).toBe(100);
    expect(r.lines[0]?.missing_rate).toBe(true);
    expect(r.pallets_without_rate).toBe(1);
  });

  it("counts days no tariff covers when there is no fallback", () => {
    const r = run([storage()], { tariffs: [] });
    expect(r.lines[0]?.storage_charge).toBe(21 * 20);
    expect(r.lines[0]?.has_tariff).toBe(false);
    expect(r.pallets_without_tariff).toBe(1);
  });

  it("does not snapshot the general tariff when the client's covers everything", () => {
    const r = run([storage({ valid_from: "2026-01-01" })], {
      pallet: { exit_date: null, entry_date: "2026-06-01" },
    });
    expect(r.applied_tariffs).toHaveLength(1);
    expect(r.applied_tariffs[0]).toMatchObject({
      source: "client_tariff",
      concept: "storage",
    });
  });
});

describe("area tariffs (roadmap 4.4)", () => {
  const general: TariffInput = {
    client_id: null,
    rate_per_pallet: 10,
    period: "daily",
    handling_in: 50,
    handling_out: 60,
    valid_from: "2026-01-01",
    valid_to: null,
    is_active: true,
  };
  const tariff = (over: Partial<ClientTariffInput>): ClientTariffInput => ({
    client_id: "c1",
    concept: "storage",
    unit: "pallet_day",
    price: 20,
    currency: "ARS",
    valid_from: "2026-01-01",
    valid_to: null,
    area_id: null,
    ...over,
  });
  const run = (clientTariffs: ClientTariffInput[], area: string | null) =>
    computeStorageBilling({
      pallets: [
        {
          id: "p1",
          client_id: "c1",
          code: "P-1",
          entry_date: "2026-07-01",
          exit_date: "2026-07-31",
          area_id: area,
        },
      ],
      tariffs: [general],
      clientTariffs,
      usdRate: null,
      clientNames: names,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });

  it("charges the area's tariff to a pallet in that area", () => {
    const r = run([tariff({}), tariff({ area_id: "frio", price: 50 })], "frio");
    expect(r.lines[0]?.storage_charge).toBe(31 * 50);
  });

  it("charges the client's tariff for every area to a pallet in another area or none", () => {
    const tariffs = [tariff({}), tariff({ area_id: "frio", price: 50 })];
    expect(run(tariffs, "granel").lines[0]?.storage_charge).toBe(31 * 20);
    expect(run(tariffs, null).lines[0]?.storage_charge).toBe(31 * 20);
  });

  it("uses the area tariff on the days it covers and the general client tariff on the rest", () => {
    const r = run(
      [
        tariff({}),
        tariff({ area_id: "frio", price: 50, valid_from: "2026-07-21" }),
      ],
      "frio",
    );
    // 1–20 at 20/day, 21–31 (11 days) at 50/day.
    expect(r.lines[0]?.storage_charge).toBe(20 * 20 + 11 * 50);
    expect(r.lines[0]?.has_tariff).toBe(true);
  });

  it("falls back to storage_tariffs on the days neither client tariff covers", () => {
    const r = run(
      [tariff({ area_id: "frio", price: 50, valid_from: "2026-07-21" })],
      "frio",
    );
    expect(r.lines[0]?.storage_charge).toBe(20 * 10 + 11 * 50);
  });

  it("takes carga and descarga from the area tariff first", () => {
    const r = run(
      [
        tariff({ concept: "handling_in", unit: "pallet", price: 100 }),
        tariff({
          concept: "handling_in",
          unit: "pallet",
          price: 300,
          area_id: "frio",
        }),
        tariff({ concept: "handling_out", unit: "pallet", price: 200 }),
      ],
      "frio",
    );
    expect(r.lines[0]?.handling_in_charge).toBe(300);
    expect(r.lines[0]?.handling_out_charge).toBe(200);
  });

  it("snapshots the area tariff with its area", () => {
    const r = run([tariff({ area_id: "frio", price: 50 })], "frio");
    expect(r.applied_tariffs).toContainEqual(
      expect.objectContaining({ source: "client_tariff", area_id: "frio" }),
    );
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
