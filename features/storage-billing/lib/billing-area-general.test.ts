import { describe, expect, it } from "vitest";

import { computeStorageBilling, type TariffInput } from "./billing";

// General per-area tariffs (storage_tariffs.area_id, 20261104080400).

const names = new Map([["c1", "Acme"]]);

const general = (patch: Partial<TariffInput>): TariffInput => ({
  client_id: null,
  rate_per_pallet: 3000,
  period: "monthly",
  handling_in: 0,
  handling_out: 0,
  valid_from: "2026-01-01",
  valid_to: null,
  is_active: true,
  ...patch,
});

const run = (areaId: string | null, tariffs: TariffInput[]) =>
  computeStorageBilling({
    pallets: [
      {
        id: "p1",
        client_id: "c1",
        code: "P-1",
        entry_date: "2026-07-01",
        exit_date: "2026-07-10",
        area_id: areaId,
      },
    ],
    tariffs,
    clientTariffs: [],
    usdRate: null,
    clientNames: names,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
  });

describe("general area tariffs", () => {
  it("prices a pallet of the area at the area's general tariff", () => {
    const r = run("a1", [
      general({}),
      general({ area_id: "a1", rate_per_pallet: 6000 }),
    ]);
    expect(r.lines[0]?.charge).toBe(2000);
    expect(r.applied_tariffs).toEqual([
      expect.objectContaining({ area_id: "a1", rate_per_pallet: 6000 }),
    ]);
  });

  it("never applies an area's tariff to another area or to no area", () => {
    const tariffs = [
      general({}),
      general({ area_id: "a1", rate_per_pallet: 6000 }),
    ];
    expect(run("a2", tariffs).lines[0]?.charge).toBe(1000);
    expect(run(null, tariffs).lines[0]?.charge).toBe(1000);
  });

  it("keeps the client's storage tariff over the general area one", () => {
    const r = run("a1", [
      general({ area_id: "a1", rate_per_pallet: 6000 }),
      general({ client_id: "c1", rate_per_pallet: 1500 }),
    ]);
    expect(r.lines[0]?.charge).toBe(500);
  });

  it("snapshots a tariff without area exactly as before", () => {
    expect(run(null, [general({})]).applied_tariffs[0]).not.toHaveProperty(
      "area_id",
    );
  });
});
