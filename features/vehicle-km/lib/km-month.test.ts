import { describe, expect, it } from "vitest";

import { buildKmMonth, previousPeriod, type KmVehicle } from "./km-month";

const truck = (id: string, patente: string, extra: Partial<KmVehicle> = {}) =>
  ({
    id,
    patente,
    alias: null,
    vehicle_type: "camion",
    is_active: true,
    ...extra,
  }) satisfies KmVehicle;

const reading = (vehicle_id: string, period: string, km: number) => ({
  id: `${vehicle_id}-${period}`,
  vehicle_id,
  period,
  km,
  read_on: `${period}-01`,
  notes: null,
});

describe("previousPeriod", () => {
  it("steps back a month, across the year", () => {
    expect(previousPeriod("2026-11")).toBe("2026-10");
    expect(previousPeriod("2026-01")).toBe("2025-12");
  });
});

describe("buildKmMonth", () => {
  it("lists active motor vehicles with the km driven and counts the missing ones", () => {
    const month = buildKmMonth(
      "2026-11",
      [
        truck("b", "BBB222"),
        truck("a", "AAA111"),
        truck("t", "TRL001", { vehicle_type: "acoplado" }),
        truck("old", "OLD999", { is_active: false }),
        truck("c", "CCC333"),
      ],
      [
        reading("a", "2026-11", 120500),
        reading("a", "2026-09", 110000),
        reading("a", "2026-10", 115000),
        reading("a", "2026-12", 130000),
        reading("b", "2026-11", 90000),
        reading("b", "2026-10", 95000),
        reading("old", "2026-11", 5000),
      ],
    );
    expect(
      month.rows.map((r) => [
        r.patente,
        r.reading?.km ?? null,
        r.previous?.period ?? null,
        r.driven,
      ]),
    ).toEqual([
      ["AAA111", 120500, "2026-10", 5500],
      ["BBB222", 90000, "2026-10", -5000],
      ["CCC333", null, null, null],
      ["OLD999", 5000, null, null],
    ]);
    expect(month.missing).toBe(1);
  });
});
