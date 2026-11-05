// Pure profitability aggregation (no DB) — used by getFleetProfitabilityAction
// and unit-tested in isolation. A trip's revenue is the freight of its invoiced
// shipments, or its manual revenue when it has no shipments (v_trip_revenue);
// both figures travel along. Trip net = revenue − trip cost − every fuel load
// tied to that trip, whatever its date (as ai_fleet_margin and the
// losing-trip insight count it). Vehicle net = Σ trip revenue − Σ trip cost −
// ALL fuel for the vehicle − ALL maintenance for the vehicle, dated in the
// period. The trips without a vehicle come as one more row
// (without_vehicle), and the totals cover the vehicles and that row: every
// trip listed. docs/roadmap.md Fase G.7.

export type TripInput = {
  id: string;
  trip_date: string;
  vehicle_id: string | null;
  origin: string | null;
  destination: string | null;
  /** The revenue the margin uses. */
  revenue: number;
  revenue_source: RevenueSource;
  /** Freight of the trip's invoiced shipments. */
  invoiced_revenue: number;
  /** Freight of its shipments still to invoice: not in revenue. */
  uninvoiced_freight: number;
  /** How many of its shipments are still to invoice: with any, the net is
   *  not final. A shipment priced by tariff has no freight until invoiced,
   *  so the count, not the amount, says it is pending. */
  uninvoiced_shipments: number;
  /** trips.revenue as typed on the trip. */
  manual_revenue: number | null;
  cost: number | null;
  vehicle: { patente: string } | null;
  driver: { full_name: string } | null;
};

/** invoiced: the trip has shipments; manual: it has none. */
export type RevenueSource = "invoiced" | "manual";

export function isRevenueSource(v: unknown): v is RevenueSource {
  return v === "invoiced" || v === "manual";
}

/** A fuel load dated in the period: the vehicle's fuel. */
export type FuelInput = {
  vehicle_id: string;
  amount: number;
  /** Linked to a purchase invoice or a treasury movement. */
  has_voucher: boolean;
};

/** A fuel load tied to a listed trip, whatever its date: the trip's fuel. */
export type TripFuelInput = {
  trip_id: string;
  amount: number;
};

export type MaintenanceInput = {
  vehicle_id: string;
  cost: number | null;
  has_voucher: boolean;
};

/** Fleet costs with no purchase invoice and no movement linked. */
export type Unvouchered = {
  fuel_count: number;
  fuel_amount: number;
  maintenance_count: number;
  maintenance_cost: number;
};

export type TripProfit = {
  id: string;
  trip_date: string;
  patente: string | null;
  driver_name: string | null;
  origin: string | null;
  destination: string | null;
  revenue: number;
  revenue_source: RevenueSource;
  invoiced_revenue: number;
  uninvoiced_freight: number;
  uninvoiced_shipments: number;
  manual_revenue: number;
  trip_cost: number;
  fuel_cost: number;
  net: number;
};

export type VehicleProfit = {
  vehicle_id: string;
  patente: string;
  trips: number;
  revenue: number;
  invoiced_revenue: number;
  uninvoiced_freight: number;
  uninvoiced_shipments: number;
  manual_revenue: number;
  trip_cost: number;
  fuel_cost: number;
  maintenance_cost: number;
  /** Services with no cost typed: unknown, not in maintenance_cost. */
  maintenance_without_cost: number;
  net: number;
};

/** The trips without a vehicle, summed. Their fuel loads have a vehicle
 *  and count there. */
export type WithoutVehicleProfit = Omit<
  VehicleProfit,
  | "vehicle_id"
  | "patente"
  | "fuel_cost"
  | "maintenance_cost"
  | "maintenance_without_cost"
>;

export type FleetProfitability = {
  trips: TripProfit[];
  vehicles: VehicleProfit[];
  /** Null when every trip has a vehicle. */
  without_vehicle: WithoutVehicleProfit | null;
  /** Over the vehicles and the trips without one. */
  totals: {
    revenue: number;
    invoiced_revenue: number;
    manual_revenue: number;
    cost: number;
    net: number;
    /** Freight still to invoice, the shipments and the trips that have some
     *  (a trip with any has a net that is not final). */
    uninvoiced_freight: number;
    uninvoiced_shipments: number;
    pending_invoicing_trips: number;
    /** Services with no cost typed (not in cost). */
    maintenance_without_cost: number;
  };
  unvouchered: Unvouchered;
};

/** Key of the trips without a vehicle in the per-vehicle maps. */
const NO_VEHICLE = "";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function add(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

export function computeProfitability(input: {
  trips: TripInput[];
  fuel: FuelInput[];
  tripFuel: TripFuelInput[];
  maintenance: MaintenanceInput[];
  vehicleNames: Map<string, string>;
}): FleetProfitability {
  const fuelByTrip = new Map<string, number>();
  for (const f of input.tripFuel) add(fuelByTrip, f.trip_id, f.amount);
  const fuelByVehicle = new Map<string, number>();
  for (const f of input.fuel) add(fuelByVehicle, f.vehicle_id, f.amount);

  const maintenanceByVehicle = new Map<string, number>();
  const noCostByVehicle = new Map<string, number>();
  for (const m of input.maintenance) {
    add(maintenanceByVehicle, m.vehicle_id, m.cost ?? 0);
    if (m.cost === null) add(noCostByVehicle, m.vehicle_id, 1);
  }

  const trips: TripProfit[] = input.trips.map((t) => {
    const revenue = t.revenue;
    const tripCost = t.cost ?? 0;
    const fuelCost = fuelByTrip.get(t.id) ?? 0;
    return {
      id: t.id,
      trip_date: t.trip_date,
      patente: t.vehicle?.patente ?? null,
      driver_name: t.driver?.full_name ?? null,
      origin: t.origin,
      destination: t.destination,
      revenue: round2(revenue),
      revenue_source: t.revenue_source,
      invoiced_revenue: round2(t.invoiced_revenue),
      uninvoiced_freight: round2(t.uninvoiced_freight),
      uninvoiced_shipments: t.uninvoiced_shipments,
      manual_revenue: round2(t.manual_revenue ?? 0),
      trip_cost: round2(tripCost),
      fuel_cost: round2(fuelCost),
      net: round2(revenue - tripCost - fuelCost),
    };
  });

  // Per-vehicle: revenue + trip cost from trips, fuel/maintenance from all
  // rows. The trips without a vehicle go under NO_VEHICLE.
  const revByVehicle = new Map<string, number>();
  const invoicedByVehicle = new Map<string, number>();
  const uninvoicedByVehicle = new Map<string, number>();
  const uninvoicedCountByVehicle = new Map<string, number>();
  const manualByVehicle = new Map<string, number>();
  const costByVehicle = new Map<string, number>();
  const tripsByVehicle = new Map<string, number>();
  for (const t of input.trips) {
    const key = t.vehicle_id ?? NO_VEHICLE;
    add(revByVehicle, key, t.revenue);
    add(invoicedByVehicle, key, t.invoiced_revenue);
    add(uninvoicedByVehicle, key, t.uninvoiced_freight);
    add(uninvoicedCountByVehicle, key, t.uninvoiced_shipments);
    add(manualByVehicle, key, t.manual_revenue ?? 0);
    add(costByVehicle, key, t.cost ?? 0);
    add(tripsByVehicle, key, 1);
  }

  const vehicleIds = new Set<string>([
    ...revByVehicle.keys(),
    ...fuelByVehicle.keys(),
    ...maintenanceByVehicle.keys(),
  ]);
  vehicleIds.delete(NO_VEHICLE);

  const vehicles: VehicleProfit[] = [...vehicleIds]
    .map((vid) => {
      const revenue = revByVehicle.get(vid) ?? 0;
      const tripCost = costByVehicle.get(vid) ?? 0;
      const fuelCost = fuelByVehicle.get(vid) ?? 0;
      const maintenanceCost = maintenanceByVehicle.get(vid) ?? 0;
      return {
        vehicle_id: vid,
        patente: input.vehicleNames.get(vid) ?? "—",
        trips: tripsByVehicle.get(vid) ?? 0,
        revenue: round2(revenue),
        invoiced_revenue: round2(invoicedByVehicle.get(vid) ?? 0),
        uninvoiced_freight: round2(uninvoicedByVehicle.get(vid) ?? 0),
        uninvoiced_shipments: uninvoicedCountByVehicle.get(vid) ?? 0,
        manual_revenue: round2(manualByVehicle.get(vid) ?? 0),
        trip_cost: round2(tripCost),
        fuel_cost: round2(fuelCost),
        maintenance_cost: round2(maintenanceCost),
        maintenance_without_cost: noCostByVehicle.get(vid) ?? 0,
        net: round2(revenue - tripCost - fuelCost - maintenanceCost),
      };
    })
    .sort((a, b) => b.net - a.net);

  const unassignedTrips = tripsByVehicle.get(NO_VEHICLE) ?? 0;
  const unassignedRevenue = revByVehicle.get(NO_VEHICLE) ?? 0;
  const unassignedCost = costByVehicle.get(NO_VEHICLE) ?? 0;
  const withoutVehicle: WithoutVehicleProfit | null =
    unassignedTrips === 0
      ? null
      : {
          trips: unassignedTrips,
          revenue: round2(unassignedRevenue),
          invoiced_revenue: round2(invoicedByVehicle.get(NO_VEHICLE) ?? 0),
          uninvoiced_freight: round2(uninvoicedByVehicle.get(NO_VEHICLE) ?? 0),
          uninvoiced_shipments: uninvoicedCountByVehicle.get(NO_VEHICLE) ?? 0,
          manual_revenue: round2(manualByVehicle.get(NO_VEHICLE) ?? 0),
          trip_cost: round2(unassignedCost),
          net: round2(unassignedRevenue - unassignedCost),
        };

  // Every trip once: the vehicles' and those without one.
  const revenue = round2(
    vehicles.reduce((s, v) => s + v.revenue, 0) + unassignedRevenue,
  );
  const invoicedRevenue = round2(
    vehicles.reduce((s, v) => s + v.invoiced_revenue, 0) +
      (withoutVehicle?.invoiced_revenue ?? 0),
  );
  const manualRevenue = round2(
    vehicles.reduce((s, v) => s + v.manual_revenue, 0) +
      (withoutVehicle?.manual_revenue ?? 0),
  );
  const cost = round2(
    vehicles.reduce(
      (s, v) => s + v.trip_cost + v.fuel_cost + v.maintenance_cost,
      0,
    ) + unassignedCost,
  );

  const fuelUnvouchered = input.fuel.filter((f) => !f.has_voucher);
  const maintenanceUnvouchered = input.maintenance.filter(
    (m) => !m.has_voucher,
  );

  return {
    trips,
    vehicles,
    without_vehicle: withoutVehicle,
    totals: {
      revenue,
      invoiced_revenue: invoicedRevenue,
      manual_revenue: manualRevenue,
      cost,
      net: round2(revenue - cost),
      uninvoiced_freight: round2(
        input.trips.reduce((s, t) => s + t.uninvoiced_freight, 0),
      ),
      uninvoiced_shipments: input.trips.reduce(
        (s, t) => s + t.uninvoiced_shipments,
        0,
      ),
      pending_invoicing_trips: input.trips.filter(
        (t) => t.uninvoiced_shipments > 0,
      ).length,
      maintenance_without_cost: input.maintenance.filter((m) => m.cost === null)
        .length,
    },
    unvouchered: {
      fuel_count: fuelUnvouchered.length,
      fuel_amount: round2(fuelUnvouchered.reduce((s, f) => s + f.amount, 0)),
      maintenance_count: maintenanceUnvouchered.length,
      maintenance_cost: round2(
        maintenanceUnvouchered.reduce((s, m) => s + (m.cost ?? 0), 0),
      ),
    },
  };
}
