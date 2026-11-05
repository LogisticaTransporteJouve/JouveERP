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
          revenue_source: "manual",
          invoiced_revenue: 0,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: 1000,
          cost: 100,
          vehicle: { patente: "AAA111" },
          driver: { full_name: "Juan" },
        },
      ],
      fuel: [
        { vehicle_id: "v1", amount: 200, has_voucher: false },
        { vehicle_id: "v1", amount: 50, has_voucher: false }, // not tied to the trip
      ],
      tripFuel: [{ trip_id: "t1", amount: 200 }],
      maintenance: [],
      vehicleNames: names,
    });
    expect(r.trips[0]?.fuel_cost).toBe(200);
    expect(r.trips[0]?.net).toBe(700); // 1000 - 100 - 200
  });

  it("counts a trip's fuel whatever its date, the vehicle's only in the range", () => {
    const r = computeProfitability({
      trips: [
        {
          id: "t1",
          trip_date: "2026-07-01",
          vehicle_id: "v1",
          origin: null,
          destination: null,
          revenue: 100,
          revenue_source: "invoiced",
          invoiced_revenue: 100,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: null,
          cost: 50,
          vehicle: { patente: "AAA111" },
          driver: null,
        },
      ],
      // The trip's load was dated the night before, outside the range.
      fuel: [],
      tripFuel: [{ trip_id: "t1", amount: 60 }],
      maintenance: [],
      vehicleNames: names,
    });
    expect(r.trips[0]).toMatchObject({ fuel_cost: 60, net: -10 });
    expect(r.vehicles[0]).toMatchObject({ fuel_cost: 0, net: 50 });
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
          revenue_source: "manual",
          invoiced_revenue: 0,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: 1000,
          cost: 100,
          vehicle: { patente: "AAA111" },
          driver: null,
        },
      ],
      fuel: [
        { vehicle_id: "v1", amount: 200, has_voucher: false },
        { vehicle_id: "v1", amount: 50, has_voucher: false },
      ],
      tripFuel: [{ trip_id: "t1", amount: 200 }],
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
          revenue_source: "manual",
          invoiced_revenue: 0,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: 5000,
          cost: 0,
          vehicle: { patente: "BBB222" },
          driver: null,
        },
      ],
      fuel: [{ vehicle_id: "v1", amount: 100, has_voucher: false }],
      tripFuel: [],
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
        { vehicle_id: "v1", amount: 100, has_voucher: false },
        { vehicle_id: "v1", amount: 40, has_voucher: true },
      ],
      tripFuel: [],
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

  it("carries the freight still to invoice per trip, vehicle and in the totals, outside the net", () => {
    const trip = (id: string, vehicle: string | null, uninvoiced: number) => ({
      id,
      trip_date: "2026-07-01",
      vehicle_id: vehicle,
      origin: null,
      destination: null,
      revenue: 100,
      revenue_source: "invoiced" as const,
      invoiced_revenue: 100,
      uninvoiced_freight: uninvoiced,
      uninvoiced_shipments: uninvoiced > 0 ? 1 : 0,
      manual_revenue: null,
      cost: 50,
      vehicle: null,
      driver: null,
    });
    const r = computeProfitability({
      trips: [
        trip("t1", "v1", 400),
        trip("t2", "v1", 0),
        trip("t3", null, 250),
      ],
      fuel: [],
      tripFuel: [],
      maintenance: [],
      vehicleNames: names,
    });
    expect(r.trips[0]).toMatchObject({ uninvoiced_freight: 400, net: 50 });
    expect(r.vehicles[0]).toMatchObject({ uninvoiced_freight: 400, net: 100 });
    expect(r.totals).toMatchObject({
      uninvoiced_freight: 650,
      pending_invoicing_trips: 2,
    });
  });

  it("carries invoiced and manual revenue apart from the revenue it uses", () => {
    const r = computeProfitability({
      trips: [
        {
          id: "t1",
          trip_date: "2026-07-01",
          vehicle_id: "v1",
          origin: null,
          destination: null,
          revenue: 300,
          revenue_source: "invoiced",
          invoiced_revenue: 300,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: 1000,
          cost: 100,
          vehicle: { patente: "AAA111" },
          driver: null,
        },
        {
          id: "t2",
          trip_date: "2026-07-02",
          vehicle_id: "v1",
          origin: null,
          destination: null,
          revenue: 800,
          revenue_source: "manual",
          invoiced_revenue: 0,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: 800,
          cost: 50,
          vehicle: { patente: "AAA111" },
          driver: null,
        },
      ],
      fuel: [],
      tripFuel: [],
      maintenance: [],
      vehicleNames: names,
    });
    expect(r.trips[0]).toMatchObject({
      revenue: 300,
      revenue_source: "invoiced",
      invoiced_revenue: 300,
      uninvoiced_freight: 0,
      manual_revenue: 1000,
      net: 200,
    });
    expect(r.vehicles[0]).toMatchObject({
      revenue: 1100,
      invoiced_revenue: 300,
      manual_revenue: 1800,
      net: 950,
    });
    expect(r.totals).toMatchObject({
      revenue: 1100,
      invoiced_revenue: 300,
      manual_revenue: 1800,
      net: 950,
    });
  });

  it("counts the trips without a vehicle in the totals and in their own row", () => {
    const r = computeProfitability({
      trips: [
        {
          id: "t1",
          trip_date: "2026-07-01",
          vehicle_id: "v1",
          origin: null,
          destination: null,
          revenue: 1000,
          revenue_source: "invoiced",
          invoiced_revenue: 1000,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: null,
          cost: 100,
          vehicle: { patente: "AAA111" },
          driver: null,
        },
        {
          id: "t2",
          trip_date: "2026-07-02",
          vehicle_id: null,
          origin: null,
          destination: null,
          revenue: 500,
          revenue_source: "invoiced",
          invoiced_revenue: 500,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: 50,
          cost: 400,
          vehicle: null,
          driver: null,
        },
      ],
      // The load of the trip without a vehicle has its own truck.
      fuel: [{ vehicle_id: "v2", amount: 30, has_voucher: true }],
      tripFuel: [{ trip_id: "t2", amount: 30 }],
      maintenance: [{ vehicle_id: "v1", cost: 200, has_voucher: true }],
      vehicleNames: names,
    });
    expect(r.without_vehicle).toEqual({
      trips: 1,
      revenue: 500,
      invoiced_revenue: 500,
      uninvoiced_freight: 0,
      uninvoiced_shipments: 0,
      manual_revenue: 50,
      trip_cost: 400,
      net: 100,
    });
    // Σ trips − the vehicles' fuel and maintenance.
    expect(r.totals).toMatchObject({
      revenue: 1500,
      invoiced_revenue: 1500,
      manual_revenue: 50,
      cost: 730,
      net: 770,
    });
    const rowsNet =
      r.vehicles.reduce((s, v) => s + v.net, 0) + (r.without_vehicle?.net ?? 0);
    expect(rowsNet).toBe(r.totals.net);
  });

  it("has no row without a vehicle when every trip has one", () => {
    const r = computeProfitability({
      trips: [],
      fuel: [],
      tripFuel: [],
      maintenance: [],
      vehicleNames: names,
    });
    expect(r.without_vehicle).toBeNull();
  });

  it("counts a trip whose shipment has no freight yet as pending", () => {
    const r = computeProfitability({
      trips: [
        {
          id: "t1",
          trip_date: "2026-07-01",
          vehicle_id: "v1",
          origin: null,
          destination: null,
          revenue: 0,
          revenue_source: "invoiced",
          invoiced_revenue: 0,
          // Priced by tariff: no freight until the liquidación is invoiced.
          uninvoiced_freight: 0,
          uninvoiced_shipments: 1,
          manual_revenue: null,
          cost: 300,
          vehicle: { patente: "AAA111" },
          driver: null,
        },
      ],
      fuel: [],
      tripFuel: [],
      maintenance: [],
      vehicleNames: names,
    });
    expect(r.trips[0]).toMatchObject({ uninvoiced_shipments: 1, net: -300 });
    expect(r.vehicles[0]).toMatchObject({ uninvoiced_shipments: 1 });
    expect(r.totals).toMatchObject({
      uninvoiced_freight: 0,
      uninvoiced_shipments: 1,
      pending_invoicing_trips: 1,
    });
  });

  it("counts the services without a cost per vehicle and in the totals", () => {
    const r = computeProfitability({
      trips: [],
      fuel: [],
      tripFuel: [],
      maintenance: [
        { vehicle_id: "v1", cost: null, has_voucher: false },
        { vehicle_id: "v1", cost: 100, has_voucher: false },
        { vehicle_id: "v2", cost: null, has_voucher: false },
      ],
      vehicleNames: names,
    });
    const v1 = r.vehicles.find((v) => v.vehicle_id === "v1");
    expect(v1).toMatchObject({
      maintenance_cost: 100,
      maintenance_without_cost: 1,
    });
    expect(r.totals).toMatchObject({ cost: 100, maintenance_without_cost: 2 });
  });
});
