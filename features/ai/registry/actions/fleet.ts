import { z } from "zod";

import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import {
  getFleetProfitabilityAction,
  listTripRevenueAction,
} from "@/features/fleet-reports/actions/profitability-actions";
import { FleetMarginInputSchema } from "@/features/fleet-reports/schema";
import { listFleetDocumentsAction } from "@/features/fleet-documents/actions/fleet-documents-actions";
import { listFuelLoadsAction } from "@/features/fuel/actions/fuel-actions";
import { listMaintenanceAction } from "@/features/maintenance/actions/maintenance-actions";
import { getShipmentsSummaryAction } from "@/features/shipments/actions/shipments-summary-actions";
import { ShipmentsSummaryInputSchema } from "@/features/shipments/schema";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import { getVehicleKmMonthAction } from "@/features/vehicle-km/actions/vehicle-km-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { type Access, userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";

import { defineAiAction } from "../define";
import {
  type AiRunResult,
  errResult,
  money,
  okResult,
  reachedCap,
} from "../result";
import { readScope } from "../scope";

// Fleet read tools. Each wraps an existing read action, inheriting its
// `userCan` gate (trips/vehicles/fuel/maintenance/fleet_documents/fleet_km
// :read) + RLS,
// so the agent adds no new data access.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The shipments a fleet read has still to invoice and their freight. They
 *  are not in the revenue, so a net that carries them is not final and is
 *  not a loss yet: the rule of the «Viajes con margen negativo» insight,
 *  which skips those trips. A shipment priced by tariff has no freight until
 *  invoiced, so the count decides. Null when there is none. */
export function pendingFreightNote(pending: {
  amount: number;
  shipments: number;
  trips?: number;
}): string | null {
  const { amount, shipments, trips } = pending;
  if (!(shipments > 0) && !(amount > 0)) return null;
  const where = trips === undefined ? "" : ` en ${trips} viaje(s)`;
  const freight =
    amount > 0 ? `flete ${money(amount)}` : "sin flete calculado todavía";
  return `${shipments} carga(s) sin facturar${where} (${freight}; una carga por tarifa no tiene flete hasta facturarse): no está en los ingresos, así que esos netos no son definitivos (no es pérdida todavía).`;
}

/** The services with no cost typed: unknown, not $0. Null when none. */
export function maintenanceWithoutCostNote(count: number): string | null {
  if (!(count > 0)) return null;
  return `${count} service(s) sin costo cargado: no están en el mantenimiento (costo desconocido, no $0).`;
}

/** Text to say a trip with shipments still to invoice is not a loss yet. */
const PENDING_FREIGHT_RULE =
  "uninvoiced_shipments counts its shipments still to invoice and " +
  "uninvoiced_freight is their freight (a shipment priced by tariff has " +
  "none until invoiced, so it can be 0): neither is in revenue, so a trip " +
  "or group with uninvoiced_shipments > 0 has a net that is not final; " +
  "never call it a loss (the loss-trip insight skips it).";

export async function runVehicles(input: {
  onlyActive?: boolean | null;
}): Promise<AiRunResult> {
  const res = await listVehiclesAction({
    onlyActive: input.onlyActive ?? false,
  });
  if (!res.ok) return errResult(res.error);
  const active = res.data.filter((v) => v.is_active).length;
  return okResult(`${res.data.length} vehicles (${active} active).`, res.data);
}

export const getVehicles = defineAiAction({
  name: "getVehicles",
  domain: "flota",
  permission: "vehicles:read",
  sideEffect: "read",
  sources: ["vehicles"],
  description:
    "Vehicle fleet: license plate, make/model, type and status " +
    "(active/inactive). For queries about trucks/vehicles.",
  input: z.object({
    onlyActive: z.boolean().nullish().describe("Active only (default false)."),
  }),
  run: (_ctx, input) => runVehicles(input),
});

/** Trips with the revenue «Rentabilidad de flota» counts (v_trip_revenue)
 *  and the manual figure apart; the total leaves out cancelled trips. The
 *  revenue needs shipments:read, as in getFleetProfitability. */
export async function runTrips(access: Access): Promise<AiRunResult> {
  const res = await listTripsAction();
  if (!res.ok) return errResult(res.error);
  const live = res.data.filter((t) => t.status !== "cancelled");
  const head = `${res.data.length} trips (${res.data.length - live.length} cancelled)`;
  if (!userCan(access, "shipments:read")) {
    return okResult(
      `${head}. Revenue not summed: it is the invoiced freight of each trip's shipments, which this user cannot read; manual_revenue is only the figure typed on the trip.`,
      res.data.map((t) => ({ ...t, revenue: null, manual_revenue: t.revenue })),
    );
  }
  const revenue = await listTripRevenueAction();
  if (!revenue.ok) return errResult(revenue.error);
  const byTrip = new Map(revenue.data.map((r) => [r.trip_id, r]));
  let total = 0;
  let missing = 0;
  let uninvoiced = 0;
  let pendingShipments = 0;
  let pendingTrips = 0;
  for (const t of live) {
    const tripRevenue = byTrip.get(t.id);
    // Created between the two reads: left out rather than counted as 0.
    if (tripRevenue === undefined) {
      missing += 1;
      continue;
    }
    total += tripRevenue.revenue;
    if (tripRevenue.uninvoiced_shipments > 0) {
      uninvoiced += tripRevenue.uninvoiced_freight;
      pendingShipments += tripRevenue.uninvoiced_shipments;
      pendingTrips += 1;
    }
  }
  const pending = pendingFreightNote({
    amount: uninvoiced,
    shipments: pendingShipments,
    trips: pendingTrips,
  });
  return okResult(
    `${head} · revenue of the ${live.length - missing} not cancelled ${money(total)} ` +
      "(invoiced freight of their shipments; a trip without shipments, its manual revenue)" +
      (missing > 0
        ? `; ${missing} trip(s) without a revenue read left out.`
        : ".") +
      (pending ? ` ${pending}` : ""),
    res.data.map((t) => ({
      ...t,
      revenue: byTrip.get(t.id)?.revenue ?? null,
      uninvoiced_freight: byTrip.get(t.id)?.uninvoiced_freight ?? null,
      uninvoiced_shipments: byTrip.get(t.id)?.uninvoiced_shipments ?? null,
      manual_revenue: t.revenue,
    })),
    { currency: "ARS", partial: missing > 0 },
  );
}

export const getTrips = defineAiAction({
  name: "getTrips",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: ["trips", "v_trip_revenue"],
  description:
    "Trips: date, origin/destination, vehicle, driver, status, cost, " +
    "revenue and manual_revenue. revenue is the invoiced freight of the " +
    "trip's shipments (without shipments, the manual figure), as in " +
    "getFleetProfitability; the total leaves out cancelled trips; without " +
    "shipments:read, revenue is null and there is no total. " +
    PENDING_FREIGHT_RULE +
    " For queries about trips or transport; " +
    "per-trip net and per-vehicle margin are in getFleetProfitability and " +
    "getFleetMargin.",
  input: z.object({}),
  run: (ctx) => runTrips(ctx.access),
});

export async function runFuelLoads(): Promise<AiRunResult> {
  const res = await listFuelLoadsAction();
  if (!res.ok) return errResult(res.error);
  const liters = res.data.reduce((s, f) => s + Number(f.liters ?? 0), 0);
  const amount = res.data.reduce((s, f) => s + Number(f.amount ?? 0), 0);
  return okResult(
    `${res.data.length} fuel loads · ${liters.toLocaleString(
      "es-AR",
    )} L · $${amount.toLocaleString("es-AR")}.`,
    res.data,
  );
}

export const getFuelLoads = defineAiAction({
  name: "getFuelLoads",
  domain: "flota",
  permission: "fuel:read",
  sideEffect: "read",
  sources: ["fuel_loads"],
  description:
    "Fuel loads: date, vehicle, trip, liters and amount. For fleet fuel " +
    "consumption or expense.",
  input: z.object({}),
  run: () => runFuelLoads(),
});

export async function runMaintenance(): Promise<AiRunResult> {
  const res = await listMaintenanceAction();
  if (!res.ok) return errResult(res.error);
  // A record without cost (unknown) is left out of the total and counted.
  const cost = res.data.reduce((s, m) => s + Number(m.cost ?? 0), 0);
  const noCost = res.data.filter((m) => m.cost === null).length;
  return okResult(
    `${res.data.length} maintenance records · $${cost.toLocaleString(
      "es-AR",
    )}` + (noCost > 0 ? ` · ${noCost} without cost (not in the total).` : "."),
    res.data,
  );
}

export const getMaintenance = defineAiAction({
  name: "getMaintenance",
  domain: "flota",
  permission: "maintenance:read",
  sideEffect: "read",
  sources: ["maintenance_records"],
  description:
    "Vehicle maintenance: service date, vehicle, description, cost and next " +
    "service. A record with cost null has an unknown cost: it is not in the " +
    "total and the summary counts it. For fleet repairs or servicing.",
  input: z.object({}),
  run: () => runMaintenance(),
});

export async function runFleetDocuments(): Promise<AiRunResult> {
  const res = await listFleetDocumentsAction();
  if (!res.ok) return errResult(res.error);
  const today = todayInAR();
  const expired = res.data.filter((d) => d.expires_at < today).length;
  return okResult(
    `${res.data.length} fleet documents (VTV, insurance, licenses, etc.)` +
      `${expired > 0 ? ` · ${expired} expired` : ""}, sorted by expiration.`,
    res.data,
  );
}

export const getFleetDocuments = defineAiAction({
  name: "getFleetDocuments",
  domain: "flota",
  permission: "fleet_documents:read",
  sideEffect: "read",
  sources: ["fleet_documents"],
  description:
    "Fleet documentation (VTV, insurance, driver's license, RTO, etc.) with " +
    "their expiration date, from the soonest to expire to the last. For " +
    "expirations of vehicle/driver paperwork.",
  input: z.object({}),
  run: () => runFleetDocuments(),
});

export const getVehicleKm = defineAiAction({
  name: "getVehicleKm",
  domain: "flota",
  permission: "fleet_km:read",
  sideEffect: "read",
  sources: ["vehicle_km_readings", "vehicles"],
  description:
    "Monthly odometer readings for one month (YYYY-MM, default the current " +
    "one): each active motor vehicle with that month's km, the previous " +
    "reading and the km driven between them (negative = the odometer went " +
    "down), plus how many vehicles still lack the reading.",
  input: z.object({
    period: z
      .string()
      .nullish()
      .describe("Month YYYY-MM (default: the current month)."),
  }),
  run: async (_ctx, input) => {
    const period = input.period ?? todayInAR().slice(0, 7);
    const res = await getVehicleKmMonthAction({ period });
    if (!res.ok) return errResult(res.error);
    const driven = res.data.rows.reduce((s, r) => s + (r.driven ?? 0), 0);
    return okResult(
      `Km ${period}: ${res.data.rows.length} vehicles, ` +
        `${res.data.missing} without a reading · ` +
        `${driven.toLocaleString("es-AR")} km driven (vehicles with both readings).`,
      res.data,
    );
  },
});

export async function runFleetProfitability(input: {
  periodStart: string;
  periodEnd: string;
}): Promise<AiRunResult> {
  if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd)) {
    return errResult("Invalid date range (use YYYY-MM-DD).");
  }
  const res = await getFleetProfitabilityAction(input);
  if (!res.ok) return errResult(res.error);
  const { totals, trips, vehicles, without_vehicle } = res.data;
  const pending = pendingFreightNote({
    amount: totals.uninvoiced_freight,
    shipments: totals.uninvoiced_shipments,
    trips: totals.pending_invoicing_trips,
  });
  const noCost = maintenanceWithoutCostNote(totals.maintenance_without_cost);
  return okResult(
    `Fleet profitability ${input.periodStart}→${input.periodEnd}: ` +
      `${trips.length} trips, ${vehicles.length} vehicles` +
      (without_vehicle
        ? ` (+ ${without_vehicle.trips} trip(s) without a vehicle, in the totals)`
        : "") +
      ` · net $${totals.net.toLocaleString("es-AR")} ` +
      `(revenue $${totals.revenue.toLocaleString("es-AR")} − cost $${totals.cost.toLocaleString(
        "es-AR",
      )}; invoiced $${totals.invoiced_revenue.toLocaleString("es-AR")}, ` +
      `manual $${totals.manual_revenue.toLocaleString("es-AR")}).` +
      (pending ? ` ${pending}` : "") +
      (noCost ? ` ${noCost}` : ""),
    res.data,
  );
}

export const getFleetProfitability = defineAiAction({
  name: "getFleetProfitability",
  domain: "flota",
  permission: ["trips:read", "shipments:read"],
  sideEffect: "read",
  sources: [
    "trips",
    "v_trip_revenue",
    "shipments",
    "fuel_loads",
    "maintenance_records",
    "vehicles",
  ],
  description:
    "Fleet profitability over a date range: net per trip " +
    "(revenue − cost − fuel) and per vehicle (includes maintenance). " +
    "A trip with shipments earns the freight of its invoiced shipments; " +
    "without shipments, its manual revenue. Both figures (invoiced, manual) " +
    "come per trip, per vehicle and in the totals. The trips without a " +
    "vehicle come in without_vehicle, and the totals cover them too. " +
    PENDING_FREIGHT_RULE +
    " The totals give it with the count of such trips " +
    "(pending_invoicing_trips). maintenance_without_cost counts services " +
    "with no cost typed: unknown, not in the maintenance cost. " +
    "Requires date from and to (YYYY-MM-DD). For trip or truck profitability.",
  input: z.object({
    periodStart: z.string().describe("Date from, format YYYY-MM-DD."),
    periodEnd: z.string().describe("Date to, format YYYY-MM-DD."),
  }),
  run: (_ctx, input) => runFleetProfitability(input),
});

export const getFleetMargin = defineAiAction({
  name: "getFleetMargin",
  domain: "flota",
  permission: ["trips:read", "shipments:read"],
  sideEffect: "read",
  sources: [
    "ai_fleet_margin",
    "v_trip_revenue",
    "trips",
    "fuel_loads",
    "maintenance_records",
    "shipments",
  ],
  description:
    "Margen de flota en un rango de fechas agrupado por viaje, chofer, vehículo o cliente: ingresos (el flete facturado de las cargas del viaje; sin cargas, el ingreso manual del viaje), facturado y manual por separado, costo del viaje, combustible imputado, mantenimiento (por vehículo), neto y margen %, con totales del rango. Por vehículo, los viajes sin vehículo son el grupo none («Sin vehículo»), así que el ingreso total es el mismo que por viaje (el neto por vehículo además descuenta el combustible sin viaje y el mantenimiento). uninvoiced_shipments (y total_uninvoiced_shipments) cuenta las cargas todavía sin facturar y uninvoiced_freight (y total_uninvoiced_freight) es su flete (una carga por tarifa no tiene flete hasta facturarse, así que puede ser 0): no están en los ingresos, así que el neto de un grupo con uninvoiced_shipments > 0 no es definitivo y no hay que llamarlo pérdida. maintenance_without_cost (y total_maintenance_without_cost) cuenta los services sin costo cargado: no están en el mantenimiento. Por cliente, cada carga aporta su flete facturado y los costos se reparten según el flete; su uninvoiced_shipments suma además las cargas sin facturar y sin flete (por tarifa) de otros clientes en sus viajes, que dejan abierto ese reparto, y total_uninvoiced_shipments cuenta cada carga una vez.Alcance opcional (fiscal/internal/all) por el canal del viaje; con un alcance, el combustible sin viaje y el mantenimiento (sin canal) no cuentan.",
  input: FleetMarginInputSchema,
  run: async (_ctx, input) => {
    const { label } = readScope(input.scope);
    const res = await getFleetMarginAction(input);
    if (!res.ok) return errResult(res.error);
    const first = res.data[0];
    const groups = first?.total_groups ?? 0;
    const pending = pendingFreightNote({
      amount: first?.total_uninvoiced_freight ?? 0,
      shipments: first?.total_uninvoiced_shipments ?? 0,
    });
    const noCost = maintenanceWithoutCostNote(
      first?.total_maintenance_without_cost ?? 0,
    );
    return okResult(
      `${label}: margen ${input.from}→${input.to} por ${input.groupBy ?? "vehicle"}: ${groups} grupos · ` +
        `ingresos ${money(first?.total_revenue ?? 0)} · neto ${money(first?.total_net ?? 0)}` +
        (groups > res.data.length
          ? ` (se muestran ${res.data.length}).`
          : ".") +
        (pending ? ` ${pending}` : "") +
        (noCost ? ` ${noCost}` : ""),
      { rows: res.data },
      { currency: "ARS", partial: groups > res.data.length },
    );
  },
});

export const getDrivers = defineAiAction({
  name: "getDrivers",
  domain: "flota",
  permission: "drivers:read",
  sideEffect: "read",
  sources: ["drivers"],
  description:
    "Choferes: nombre, licencia (número y categoría), teléfono, estado y empleado vinculado.",
  input: z.object({
    onlyActive: z.boolean().nullish().describe("Solo activos (default false)."),
  }),
  run: async (_ctx, input) => {
    const res = await listDriversAction({
      onlyActive: input.onlyActive ?? false,
    });
    if (!res.ok) return errResult(res.error);
    const active = res.data.filter((d) => d.is_active).length;
    return okResult(
      `${res.data.length} choferes (${active} activos).`,
      res.data,
    );
  },
});

export const getShipmentsSummary = defineAiAction({
  name: "getShipmentsSummary",
  domain: "flota",
  permission: "shipments:read",
  sideEffect: "read",
  sources: ["ai_shipments_summary", "shipments"],
  description:
    "Cargas (envíos) por estado y cliente en un rango de fechas: cantidad, flete total sin las canceladas, cuántas ya están facturadas y su flete facturado (descontadas las NC y sumadas las ND de su factura), y cuántas no tienen flete todavía (por tarifa).",
  input: ShipmentsSummaryInputSchema,
  run: async (_ctx, input) => {
    const res = await getShipmentsSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    // Every other fleet figure leaves cancelled cargas out.
    const live = res.data.filter((r) => r.status !== "cancelled");
    const count = live.reduce((s, r) => s + r.shipments, 0);
    const freight = live.reduce((s, r) => s + r.freight, 0);
    const unpriced = live.reduce((s, r) => s + r.unpriced, 0);
    const cancelled = res.data
      .filter((r) => r.status === "cancelled")
      .reduce((s, r) => s + r.shipments, 0);
    return okResult(
      `${count} cargas entre ${input.from} y ${input.to} · flete ${money(freight)}` +
        (cancelled > 0 ? ` (${cancelled} canceladas, fuera del total)` : "") +
        "." +
        (unpriced > 0
          ? ` ${unpriced} cargas sin flete (por tarifa): el flete total no es definitivo.`
          : ""),
      { rows: res.data },
      { currency: "ARS", partial: reachedCap(res.data.length) },
    );
  },
});
