import { z } from "zod";

import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import { getFleetProfitabilityAction } from "@/features/fleet-reports/actions/profitability-actions";
import { FleetMarginInputSchema } from "@/features/fleet-reports/schema";
import { listFleetDocumentsAction } from "@/features/fleet-documents/actions/fleet-documents-actions";
import { listFuelLoadsAction } from "@/features/fuel/actions/fuel-actions";
import { listMaintenanceAction } from "@/features/maintenance/actions/maintenance-actions";
import { getShipmentsSummaryAction } from "@/features/shipments/actions/shipments-summary-actions";
import { ShipmentsSummaryInputSchema } from "@/features/shipments/schema";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";

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
// `userCan` gate (trips/vehicles/fuel/maintenance/fleet_documents :read) + RLS,
// so the agent adds no new data access.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export async function runTrips(): Promise<AiRunResult> {
  const res = await listTripsAction();
  if (!res.ok) return errResult(res.error);
  const withRevenue = res.data.reduce((s, t) => s + Number(t.revenue ?? 0), 0);
  return okResult(
    `${res.data.length} trips · total revenue $${withRevenue.toLocaleString(
      "es-AR",
    )}.`,
    res.data,
  );
}

export const getTrips = defineAiAction({
  name: "getTrips",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: ["trips"],
  description:
    "Trips: date, origin/destination, vehicle, driver, status, revenue and " +
    "cost. For queries about trips or transport.",
  input: z.object({}),
  run: () => runTrips(),
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
  const cost = res.data.reduce((s, m) => s + Number(m.cost ?? 0), 0);
  return okResult(
    `${res.data.length} maintenance records · $${cost.toLocaleString(
      "es-AR",
    )}.`,
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
    "service. For fleet repairs or servicing.",
  input: z.object({}),
  run: () => runMaintenance(),
});

export async function runFleetDocuments(): Promise<AiRunResult> {
  const res = await listFleetDocumentsAction();
  if (!res.ok) return errResult(res.error);
  const today = new Date().toISOString().slice(0, 10);
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

export async function runFleetProfitability(input: {
  periodStart: string;
  periodEnd: string;
}): Promise<AiRunResult> {
  if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd)) {
    return errResult("Invalid date range (use YYYY-MM-DD).");
  }
  const res = await getFleetProfitabilityAction(input);
  if (!res.ok) return errResult(res.error);
  const { totals, trips, vehicles } = res.data;
  return okResult(
    `Fleet profitability ${input.periodStart}→${input.periodEnd}: ` +
      `${trips.length} trips, ${vehicles.length} vehicles · ` +
      `net $${totals.net.toLocaleString("es-AR")} ` +
      `(revenue $${totals.revenue.toLocaleString("es-AR")} − cost $${totals.cost.toLocaleString(
        "es-AR",
      )}).`,
    res.data,
  );
}

export const getFleetProfitability = defineAiAction({
  name: "getFleetProfitability",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: ["trips", "fuel_loads", "maintenance_records", "vehicles"],
  description:
    "Fleet profitability over a date range: net per trip " +
    "(revenue − cost − fuel) and per vehicle (includes maintenance). " +
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
  permission: "trips:read",
  sideEffect: "read",
  sources: [
    "ai_fleet_margin",
    "trips",
    "fuel_loads",
    "maintenance_records",
    "shipments",
  ],
  description:
    "Margen de flota en un rango de fechas agrupado por viaje, chofer, vehículo o cliente: ingresos, costo del viaje, combustible imputado, mantenimiento (por vehículo), neto y margen %, con totales del rango. Por cliente reparte cada viaje según el flete de sus cargas. Alcance opcional (fiscal/internal/all) por el canal del viaje; con un alcance, el combustible sin viaje y el mantenimiento (sin canal) no cuentan.",
  input: FleetMarginInputSchema,
  run: async (_ctx, input) => {
    const { label } = readScope(input.scope);
    const res = await getFleetMarginAction(input);
    if (!res.ok) return errResult(res.error);
    const first = res.data[0];
    const groups = first?.total_groups ?? 0;
    return okResult(
      `${label}: margen ${input.from}→${input.to} por ${input.groupBy ?? "vehicle"}: ${groups} grupos · ` +
        `ingresos ${money(first?.total_revenue ?? 0)} · neto ${money(first?.total_net ?? 0)}` +
        (groups > res.data.length ? ` (se muestran ${res.data.length}).` : "."),
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
    "Cargas (envíos) por estado y cliente en un rango de fechas: cantidad, flete total y cuántas ya están facturadas.",
  input: ShipmentsSummaryInputSchema,
  run: async (_ctx, input) => {
    const res = await getShipmentsSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    const count = res.data.reduce((s, r) => s + r.shipments, 0);
    const freight = res.data.reduce((s, r) => s + r.freight, 0);
    return okResult(
      `${count} cargas entre ${input.from} y ${input.to} · flete ${money(freight)}.`,
      { rows: res.data },
      { currency: "ARS", partial: reachedCap(res.data.length) },
    );
  },
});
