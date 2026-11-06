import { describe, expect, it } from "vitest";

import { buildDriverKmDays, buildVehicleKmDays } from "./km-days";

const ANA = { id: "d1", full_name: "Ana" };
const BETO = { id: "d2", full_name: "Beto" };
const TRUCK = { id: "v1", patente: "AA111AA" };

describe("buildVehicleKmDays", () => {
  it("joins km and drivers by day, newest first", () => {
    expect(
      buildVehicleKmDays(
        [
          { day: "2026-11-03", km: 210 },
          { day: "2026-11-04", km: 80 },
        ],
        [
          { day: "2026-11-03", driver: ANA },
          { day: "2026-11-03", driver: ANA },
          { day: "2026-11-03", driver: BETO },
          { day: "2026-11-05", driver: BETO },
          { day: "2026-11-04", driver: null },
        ],
      ),
    ).toEqual([
      { day: "2026-11-05", km: null, drivers: [BETO] },
      { day: "2026-11-04", km: 80, drivers: [] },
      { day: "2026-11-03", km: 210, drivers: [ANA, BETO] },
    ]);
  });
});

describe("buildDriverKmDays", () => {
  it("counts a vehicle-day once however many trips share it", () => {
    const result = buildDriverKmDays(
      [
        {
          id: "t1",
          day: "2026-11-03",
          origin: "Rosario",
          destination: "Córdoba",
          vehicle: TRUCK,
        },
        {
          id: "t2",
          day: "2026-11-03",
          origin: null,
          destination: null,
          vehicle: TRUCK,
        },
        {
          id: "t3",
          day: "2026-11-05",
          origin: null,
          destination: "Santa Fe",
          vehicle: null,
        },
      ],
      [{ vehicle_id: "v1", day: "2026-11-03", km: 210.5 }],
    );
    expect(result.total).toBe(210.5);
    expect(result.trips.map((t) => [t.trip_id, t.km, t.route])).toEqual([
      ["t3", null, "Santa Fe"],
      ["t1", 210.5, "Rosario → Córdoba"],
      ["t2", 210.5, null],
    ]);
  });
});
