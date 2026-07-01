import { tool } from "ai";
import { z } from "zod";

import { getFleetProfitabilityAction } from "@/features/fleet-reports/actions/profitability-actions";
import { listFleetDocumentsAction } from "@/features/fleet-documents/actions/fleet-documents-actions";
import { listFuelLoadsAction } from "@/features/fuel/actions/fuel-actions";
import { listMaintenanceAction } from "@/features/maintenance/actions/maintenance-actions";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";

import { type AiToolResult, errResult, okResult } from "./result";

// Fleet read tools. Each wraps an existing read action, inheriting its
// `userCan` gate (trips/vehicles/fuel/maintenance/fleet_documents :read) + RLS,
// so the agent adds no new data access.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function runVehicles(input: {
  onlyActive?: boolean | null;
}): Promise<AiToolResult> {
  const res = await listVehiclesAction({ onlyActive: input.onlyActive ?? false });
  if (!res.ok) return errResult(res.error);
  const active = res.data.filter((v) => v.is_active).length;
  return okResult(`${res.data.length} vehicles (${active} active).`, res.data);
}

export const getVehicles = tool({
  description:
    "Vehicle fleet: license plate, make/model, type and status " +
    "(active/inactive). For queries about trucks/vehicles.",
  inputSchema: z.object({
    onlyActive: z.boolean().nullish().describe("Active only (default false)."),
  }),
  execute: (input) => runVehicles(input),
});

export async function runTrips(): Promise<AiToolResult> {
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

export const getTrips = tool({
  description:
    "Trips: date, origin/destination, vehicle, driver, status, revenue and " +
    "cost. For queries about trips or transport.",
  inputSchema: z.object({}),
  execute: () => runTrips(),
});

export async function runFuelLoads(): Promise<AiToolResult> {
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

export const getFuelLoads = tool({
  description:
    "Fuel loads: date, vehicle, trip, liters and amount. For fleet fuel " +
    "consumption or expense.",
  inputSchema: z.object({}),
  execute: () => runFuelLoads(),
});

export async function runMaintenance(): Promise<AiToolResult> {
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

export const getMaintenance = tool({
  description:
    "Vehicle maintenance: service date, vehicle, description, cost and next " +
    "service. For fleet repairs or servicing.",
  inputSchema: z.object({}),
  execute: () => runMaintenance(),
});

export async function runFleetDocuments(): Promise<AiToolResult> {
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

export const getFleetDocuments = tool({
  description:
    "Fleet documentation (VTV, insurance, driver's license, RTO, etc.) with " +
    "their expiration date, from the soonest to expire to the last. For " +
    "expirations of vehicle/driver paperwork.",
  inputSchema: z.object({}),
  execute: () => runFleetDocuments(),
});

export async function runFleetProfitability(input: {
  periodStart: string;
  periodEnd: string;
}): Promise<AiToolResult> {
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

export const getFleetProfitability = tool({
  description:
    "Fleet profitability over a date range: net per trip " +
    "(revenue − cost − fuel) and per vehicle (includes maintenance). " +
    "Requires date from and to (YYYY-MM-DD). For trip or truck profitability.",
  inputSchema: z.object({
    periodStart: z.string().describe("Date from, format YYYY-MM-DD."),
    periodEnd: z.string().describe("Date to, format YYYY-MM-DD."),
  }),
  execute: (input) => runFleetProfitability(input),
});
