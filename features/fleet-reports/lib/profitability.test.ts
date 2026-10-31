import { describe, expect, it } from "vitest";

import { computeProfitability } from "./profitability";

const names = new Map([
  ["v1", "AAA111"],
  ["v2", "BBB222"],
]);

describe("computeProfitability", () => {
  it("computes trip net = revenue - trip cost - trip-tied fuel", () => {
    const r = computeProfitability({
      trips: [
        {
          id: "t1",
          trip_date: "2026-07-01",
          vehicle_id: "v1",
          origin: "A",
          destination: "B",
          revenue: 1000,
          cost: 100,
          vehicle: { patente: "AAA111" },
          driver: { full_name: "Juan" },
        },
      ],
      fuel: [
        { vehicle_id: "v1", trip_id: "t1", amount: 200, has_voucher: false },
        { vehicle_id: "v1", trip_id: null, amount: 50, has_voucher: false }, // not tied to the trip
      ],
      maintenance: [],
      vehicleNames: names,
    });
    expect(r.trips[0]?.fuel_cost).toBe(200);
    expect(r.trips[0]?.net).toBe(700); // 1000 - 100 - 200
  });

  it("vehicle net uses ALL fuel + maintenance, not just trip-tied", () => {
    const r = computeProfitability({
      trips: [
        {
          id: "t1",
          trip_date: "2026-07-01",
          vehicle_id: "v1",
          origin: null,
          destination: null,
          revenue: 1000,
          cost: 100,
          vehicle: { patente: "AAA111" },
          driver: null,
        },
      ],
      fuel: [
        { vehicle_id: "v1", trip_id: "t1", amount: 200, has_voucher: false },
        { vehicle_id: "v1", trip_id: null, amount: 50, has_voucher: false },
      ],
      maintenance: [{ vehicle_id: "v1", cost: 300, has_voucher: false }],
      vehicleNames: names,
    });
    const v1 = r.vehicles.find((v) => v.vehicle_id === "v1");
    expect(v1?.revenue).toBe(1000);
    expect(v1?.fuel_cost).toBe(250); // 200 + 50
    expect(v1?.maintenance_cost).toBe(300);
    expect(v1?.net).toBe(350); // 1000 - 100 - 250 - 300
  });

  it("includes vehicles with costs but no trips and sorts by net desc", () => {
    const r = computeProfitability({
      trips: [
        {
          id: "t1",
          trip_date: "2026-07-01",
          vehicle_id: "v2",
          origin: null,
          destination: null,
          revenue: 5000,
          cost: 0,
          vehicle: { patente: "BBB222" },
          driver: null,
        },
      ],
      fuel: [
        { vehicle_id: "v1", trip_id: null, amount: 100, has_voucher: false },
      ],
      maintenance: [{ vehicle_id: "v1", cost: 0, has_voucher: false }],
      vehicleNames: names,
    });
    expect(r.vehicles).toHaveLength(2);
    expect(r.vehicles[0]?.vehicle_id).toBe("v2"); // net 5000 first
    const v1 = r.vehicles.find((v) => v.vehicle_id === "v1");
    expect(v1?.net).toBe(-100);
    expect(r.totals.net).toBe(4900);
  });

  it("totals the costs with no voucher linked", () => {
    const r = computeProfitability({
      trips: [],
      fuel: [
        { vehicle_id: "v1", trip_id: null, amount: 100, has_voucher: false },
        { vehicle_id: "v1", trip_id: null, amount: 40, has_voucher: true },
      ],
      maintenance: [
        { vehicle_id: "v1", cost: 300, has_voucher: false },
        { vehicle_id: "v1", cost: null, has_voucher: false },
        { vehicle_id: "v1", cost: 500, has_voucher: true },
      ],
      vehicleNames: names,
    });
    expect(r.unvouchered).toEqual({
      fuel_count: 1,
      fuel_amount: 100,
      maintenance_count: 2,
      maintenance_cost: 300,
    });
  });
});
