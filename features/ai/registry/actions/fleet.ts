import { z } from "zod";

import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import { listTripRevenueAction } from "@/features/fleet-reports/actions/trip-revenue-actions";
import { FleetMarginInputSchema } from "@/features/fleet-reports/schema";
import { listFleetDocumentsAction } from "@/features/fleet-documents/actions/fleet-documents-actions";
import { listFuelLoadsAction } from "@/features/fuel/actions/fuel-actions";
import { listMaintenanceAction } from "@/features/maintenance/actions/maintenance-actions";
import { getShipmentsSummaryAction } from "@/features/shipments/actions/shipments-summary-actions";
import { ShipmentsSummaryInputSchema } from "@/features/shipments/schema";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import { getVehicleKmRangeAction } from "@/features/vehicle-km/actions/vehicle-km-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { type Access, userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { IsoDateSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import {
  type AiRunResult,
  errResult,
  money,
  okResult,
  reachedCap,
} from "../result";
import { readScope } from "../scope";

import { resolveFleetRefs } from "./fleet-refs";

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
function maintenanceWithoutCostNote(count: number): string | null {
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

/** Rows a fleet list returns by default and at most. */
const LIST_DEFAULT = 200;
const LIST_MAX = 500;

/** The filters every fleet list takes: a vehicle, a date range and a cap. */
const fleetListShape = {
  vehicle: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .nullish()
    .describe(
      "Vehicle: license plate (e.g. AB123CD; spaces and dashes ignored), alias or UUID.",
    ),
  from: IsoDateSchema.nullish().describe("Date from, YYYY-MM-DD."),
  to: IsoDateSchema.nullish().describe("Date to, YYYY-MM-DD (inclusive)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIST_MAX)
    .nullish()
    .describe(
      `Max rows, newest first (default ${LIST_DEFAULT}, max ${LIST_MAX}).`,
    ),
};

export type FleetListInput = {
  vehicle?: string | null;
  driver?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
};

/** What a fleet list asks its action for: the resolved filters and one row
 *  over the cap, so a cut list can say so. */
export async function fleetFilter(
  access: Access,
  input: FleetListInput,
): Promise<
  | {
      ok: true;
      filter: {
        vehicleId: string | null;
        driverId: string | null;
        from: string | null;
        to: string | null;
        limit: number;
      };
      cap: number;
      label: string;
    }
  | { ok: false; error: string }
> {
  if (input.from && input.to && input.from > input.to) {
    return {
      ok: false,
      error: "La fecha desde es posterior a la fecha hasta.",
    };
  }
  const refs = await resolveFleetRefs(access, input);
  if (!refs.ok) return refs;
  const cap = input.limit ?? LIST_DEFAULT;
  const parts = [
    ...refs.labels,
    ...(input.from || input.to
      ? [`${input.from ?? "inicio"}→${input.to ?? "hoy"}`]
      : []),
  ];
  return {
    ok: true,
    filter: {
      vehicleId: refs.vehicleId,
      driverId: refs.driverId,
      from: input.from ?? null,
      to: input.to ?? null,
      limit: cap + 1,
    },
    cap,
    label: parts.length ? ` (${parts.join(", ")})` : "",
  };
}

/** The sentence a list cut at `cap` adds to its summary. */
export function capNote(rows: number, cap: number): string {
  return rows > cap
    ? ` Showing the newest ${cap}: there are more, narrow the filters or raise limit.`
    : "";
}

/** Trips with their revenue (v_trip_revenue) and the manual figure apart;
 *  the total leaves out cancelled trips. The revenue needs shipments:read. */
export async function runTrips(
  access: Access,
  input: FleetListInput = {},
): Promise<AiRunResult> {
  const f = await fleetFilter(access, input);
  if (!f.ok) return errResult(f.error);
  const res = await listTripsAction(f.filter);
  if (!res.ok) return errResult(res.error);
  const cut = res.data.length > f.cap;
  const trips = res.data.slice(0, f.cap);
  const live = trips.filter((t) => t.status !== "cancelled");
  const km = live.reduce((s, t) => s + (t.km ?? 0), 0);
  const withoutKm = live.filter((t) => t.km === null).length;
  const head =
    `${trips.length} trips${f.label} (${trips.length - live.length} cancelled) · ` +
    `${km.toLocaleString("es-AR")} km of the not cancelled` +
    (withoutKm > 0 ? ` (${withoutKm} without km)` : "");
  const more = capNote(res.data.length, f.cap);
  if (!userCan(access, "shipments:read")) {
    return okResult(
      `${head}. Revenue not summed: it is the invoiced freight of each trip's shipments, which this user cannot read; manual_revenue is only the figure typed on the trip.${more}`,
      trips.map((t) => ({ ...t, revenue: null, manual_revenue: t.revenue })),
      { partial: cut },
    );
  }
  const revenue = await listTripRevenueAction(trips.map((t) => t.id));
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
      (pending ? ` ${pending}` : "") +
      more,
    trips.map((t) => ({
      ...t,
      revenue: byTrip.get(t.id)?.revenue ?? null,
      uninvoiced_freight: byTrip.get(t.id)?.uninvoiced_freight ?? null,
      uninvoiced_shipments: byTrip.get(t.id)?.uninvoiced_shipments ?? null,
      manual_revenue: t.revenue,
    })),
    { currency: "ARS", partial: missing > 0 || cut },
  );
}

export const getTrips = defineAiAction({
  name: "getTrips",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: ["trips", "v_trip_revenue"],
  description:
    "Trips, newest first, filterable by vehicle (plate), driver (name), " +
    "date range and limit: date, origin/destination, vehicle, driver, " +
    "status, km, cost, revenue and manual_revenue, with the km of the not " +
    "cancelled ones summed. revenue is the invoiced freight of the " +
    "trip's shipments (without shipments, the manual figure); the total " +
    "leaves out cancelled trips; without " +
    "shipments:read, revenue is null and there is no total. " +
    PENDING_FREIGHT_RULE +
    " For queries about trips or transport. The km and the drivers of ONE " +
    "vehicle in a period are in getVehicleUsage; the margin per trip, " +
    "driver, vehicle or client in getFleetMargin.",
  input: z.object({
    ...fleetListShape,
    driver: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullish()
      .describe("Driver: name or UUID."),
  }),
  run: (ctx, input) => runTrips(ctx.access, input),
});

export async function runFuelLoads(
  access: Access,
  input: FleetListInput = {},
): Promise<AiRunResult> {
  const f = await fleetFilter(access, input);
  if (!f.ok) return errResult(f.error);
  const res = await listFuelLoadsAction(f.filter);
  if (!res.ok) return errResult(res.error);
  const loads = res.data.slice(0, f.cap);
  const liters = loads.reduce((s, l) => s + Number(l.liters ?? 0), 0);
  const amount = loads.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  return okResult(
    `${loads.length} fuel loads${f.label} · ${liters.toLocaleString(
      "es-AR",
    )} L · ${money(amount)}.` + capNote(res.data.length, f.cap),
    loads,
    { partial: res.data.length > f.cap },
  );
}

export const getFuelLoads = defineAiAction({
  name: "getFuelLoads",
  domain: "flota",
  permission: "fuel:read",
  sideEffect: "read",
  sources: ["fuel_loads"],
  description:
    "Fuel loads, newest first, filterable by vehicle (plate), date range " +
    "and limit: date, vehicle, trip, liters, amount and odometer. For fleet " +
    "fuel consumption or expense.",
  input: z.object(fleetListShape),
  run: (ctx, input) => runFuelLoads(ctx.access, input),
});

export async function runMaintenance(
  access: Access,
  input: FleetListInput = {},
): Promise<AiRunResult> {
  const f = await fleetFilter(access, input);
  if (!f.ok) return errResult(f.error);
  const res = await listMaintenanceAction(f.filter);
  if (!res.ok) return errResult(res.error);
  const records = res.data.slice(0, f.cap);
  // A record without cost (unknown) is left out of the total and counted.
  const cost = records.reduce((s, m) => s + Number(m.cost ?? 0), 0);
  const noCost = records.filter((m) => m.cost === null).length;
  return okResult(
    `${records.length} maintenance records${f.label} · $${cost.toLocaleString(
      "es-AR",
    )}` +
      (noCost > 0 ? ` · ${noCost} without cost (not in the total).` : ".") +
      capNote(res.data.length, f.cap),
    records,
    { partial: res.data.length > f.cap },
  );
}

export const getMaintenance = defineAiAction({
  name: "getMaintenance",
  domain: "flota",
  permission: "maintenance:read",
  sideEffect: "read",
  sources: ["maintenance_records"],
  description:
    "Vehicle maintenance, newest first, filterable by vehicle (plate), " +
    "date range and limit: service date, vehicle, description, cost and " +
    "next service. A record with cost null has an unknown cost: it is not " +
    "in the total and the summary counts it. For fleet repairs or servicing.",
  input: z.object(fleetListShape),
  run: (ctx, input) => runMaintenance(ctx.access, input),
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
  sources: ["vehicle_km_daily", "vehicles"],
  description:
    "Km driven per vehicle in a date range (default: the current month), " +
    "from Strix (the trucks' GPS), summed day by day: each active motor " +
    "vehicle with its km, the days with km and its last day with km.",
  input: z.object({
    from: z
      .string()
      .regex(DATE_RE)
      .nullish()
      .describe("First day YYYY-MM-DD (default: the 1st of this month)."),
    to: z
      .string()
      .regex(DATE_RE)
      .nullish()
      .describe("Last day YYYY-MM-DD (default: today)."),
  }),
  run: async (_ctx, input) => {
    const today = todayInAR();
    const from = input.from ?? `${today.slice(0, 7)}-01`;
    const to = input.to ?? today;
    const res = await getVehicleKmRangeAction({ from, to });
    if (!res.ok) return errResult(res.error);
    return okResult(
      `Km ${from} → ${to} (Strix): ${res.data.rows.length} vehicles, ` +
        `${res.data.total.toLocaleString("es-AR")} km in total.`,
      res.data,
    );
  },
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
    "Margen de flota en un rango de fechas agrupado por viaje, chofer, vehículo o cliente: ingresos (el flete facturado de las cargas del viaje; sin cargas, el ingreso manual del viaje), facturado y manual por separado, costo del viaje, combustible (el de un viaje es todo el ligado a él, sea cual sea su fecha; por vehículo, el cargado en el rango), mantenimiento (por vehículo), neto y margen %, con totales del rango. Por vehículo, los viajes sin vehículo son el grupo none («Sin vehículo»), así que el ingreso total es el mismo que por viaje (el neto por vehículo cuenta el combustible por su fecha en el rango, no el de un viaje cargado fuera del rango, y además descuenta el combustible sin viaje y el mantenimiento, así que no es la suma de los netos por viaje). uninvoiced_shipments (y total_uninvoiced_shipments) cuenta las cargas todavía sin facturar y uninvoiced_freight (y total_uninvoiced_freight) es su flete (una carga por tarifa no tiene flete hasta facturarse, así que puede ser 0): no están en los ingresos, así que el neto de un grupo con uninvoiced_shipments > 0 no es definitivo y no hay que llamarlo pérdida. maintenance_without_cost (y total_maintenance_without_cost) cuenta los services sin costo cargado: no están en el mantenimiento. Por cliente, cada carga aporta su flete facturado y los costos se reparten según el flete; su uninvoiced_shipments suma además las cargas sin facturar y sin flete (por tarifa) de otros clientes en sus viajes, que dejan abierto ese reparto, y total_uninvoiced_shipments cuenta cada carga una vez.Alcance opcional (fiscal/internal/all) por el canal del viaje; con un alcance, el combustible sin viaje y el mantenimiento (sin canal) no cuentan.",
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
