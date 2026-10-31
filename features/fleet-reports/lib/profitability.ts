// Pure profitability aggregation (no DB) — used by getFleetProfitabilityAction
// and unit-tested in isolation. A trip's revenue is the freight of its invoiced
// shipments, or its manual revenue when it has no shipments (v_trip_revenue);
// both figures travel along. Trip net = revenue − trip cost − fuel tied to
// that trip. Vehicle net = Σ trip revenue − Σ trip cost − ALL fuel for the
// vehicle − ALL maintenance for the vehicle (over the period). docs/roadmap.md
// Fase G.7.

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

export type FuelInput = {
  vehicle_id: string;
  trip_id: string | null;
  amount: number;
  /** Linked to a purchase invoice or a treasury movement. */
  has_voucher: boolean;
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
  manual_revenue: number;
  trip_cost: number;
  fuel_cost: number;
  maintenance_cost: number;
  net: number;
};

export type FleetProfitability = {
  trips: TripProfit[];
  vehicles: VehicleProfit[];
  totals: {
    revenue: number;
    invoiced_revenue: number;
    manual_revenue: number;
    cost: number;
    net: number;
  };
  unvouchered: Unvouchered;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function add(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

export function computeProfitability(input: {
  trips: TripInput[];
  fuel: FuelInput[];
  maintenance: MaintenanceInput[];
  vehicleNames: Map<string, string>;
}): FleetProfitability {
  const fuelByTrip = new Map<string, number>();
  const fuelByVehicle = new Map<string, number>();
  for (const f of input.fuel) {
    if (f.trip_id) add(fuelByTrip, f.trip_id, f.amount);
    add(fuelByVehicle, f.vehicle_id, f.amount);
  }

  const maintenanceByVehicle = new Map<string, number>();
  for (const m of input.maintenance) {
    add(maintenanceByVehicle, m.vehicle_id, m.cost ?? 0);
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
      manual_revenue: round2(t.manual_revenue ?? 0),
      trip_cost: round2(tripCost),
      fuel_cost: round2(fuelCost),
      net: round2(revenue - tripCost - fuelCost),
    };
  });

  // Per-vehicle: revenue + trip cost from trips, fuel/maintenance from all rows.
  const revByVehicle = new Map<string, number>();
  const invoicedByVehicle = new Map<string, number>();
  const manualByVehicle = new Map<string, number>();
  const costByVehicle = new Map<string, number>();
  const tripsByVehicle = new Map<string, number>();
  for (const t of input.trips) {
    if (!t.vehicle_id) continue;
    add(revByVehicle, t.vehicle_id, t.revenue);
    add(invoicedByVehicle, t.vehicle_id, t.invoiced_revenue);
    add(manualByVehicle, t.vehicle_id, t.manual_revenue ?? 0);
    add(costByVehicle, t.vehicle_id, t.cost ?? 0);
    add(tripsByVehicle, t.vehicle_id, 1);
  }

  const vehicleIds = new Set<string>([
    ...revByVehicle.keys(),
    ...fuelByVehicle.keys(),
    ...maintenanceByVehicle.keys(),
  ]);

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
        manual_revenue: round2(manualByVehicle.get(vid) ?? 0),
        trip_cost: round2(tripCost),
        fuel_cost: round2(fuelCost),
        maintenance_cost: round2(maintenanceCost),
        net: round2(revenue - tripCost - fuelCost - maintenanceCost),
      };
    })
    .sort((a, b) => b.net - a.net);

  const revenue = round2(vehicles.reduce((s, v) => s + v.revenue, 0));
  const invoicedRevenue = round2(
    vehicles.reduce((s, v) => s + v.invoiced_revenue, 0),
  );
  const manualRevenue = round2(
    vehicles.reduce((s, v) => s + v.manual_revenue, 0),
  );
  const cost = round2(
    vehicles.reduce(
      (s, v) => s + v.trip_cost + v.fuel_cost + v.maintenance_cost,
      0,
    ),
  );

  const fuelUnvouchered = input.fuel.filter((f) => !f.has_voucher);
  const maintenanceUnvouchered = input.maintenance.filter(
    (m) => !m.has_voucher,
  );

  return {
    trips,
    vehicles,
    totals: {
      revenue,
      invoiced_revenue: invoicedRevenue,
      manual_revenue: manualRevenue,
      cost,
      net: round2(revenue - cost),
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
