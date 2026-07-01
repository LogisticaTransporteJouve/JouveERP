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
  return okResult(`${res.data.length} vehículos (${active} activos).`, res.data);
}

export const getVehicles = tool({
  description:
    "Flota de vehículos: patente, marca/modelo, tipo y estado (activo/baja). " +
    "Para consultas sobre camiones/vehículos.",
  inputSchema: z.object({
    onlyActive: z.boolean().nullish().describe("Solo activos (default false)."),
  }),
  execute: (input) => runVehicles(input),
});

export async function runTrips(): Promise<AiToolResult> {
  const res = await listTripsAction();
  if (!res.ok) return errResult(res.error);
  const withRevenue = res.data.reduce((s, t) => s + Number(t.revenue ?? 0), 0);
  return okResult(
    `${res.data.length} viajes · facturación total $${withRevenue.toLocaleString(
      "es-AR",
    )}.`,
    res.data,
  );
}

export const getTrips = tool({
  description:
    "Viajes: fecha, origen/destino, vehículo, chofer, estado, facturación y " +
    "costo. Para consultas sobre viajes o transporte.",
  inputSchema: z.object({}),
  execute: () => runTrips(),
});

export async function runFuelLoads(): Promise<AiToolResult> {
  const res = await listFuelLoadsAction();
  if (!res.ok) return errResult(res.error);
  const liters = res.data.reduce((s, f) => s + Number(f.liters ?? 0), 0);
  const amount = res.data.reduce((s, f) => s + Number(f.amount ?? 0), 0);
  return okResult(
    `${res.data.length} cargas de combustible · ${liters.toLocaleString(
      "es-AR",
    )} L · $${amount.toLocaleString("es-AR")}.`,
    res.data,
  );
}

export const getFuelLoads = tool({
  description:
    "Cargas de combustible: fecha, vehículo, viaje, litros e importe. Para " +
    "consumo o gasto de combustible de la flota.",
  inputSchema: z.object({}),
  execute: () => runFuelLoads(),
});

export async function runMaintenance(): Promise<AiToolResult> {
  const res = await listMaintenanceAction();
  if (!res.ok) return errResult(res.error);
  const cost = res.data.reduce((s, m) => s + Number(m.cost ?? 0), 0);
  return okResult(
    `${res.data.length} registros de mantenimiento · $${cost.toLocaleString(
      "es-AR",
    )}.`,
    res.data,
  );
}

export const getMaintenance = tool({
  description:
    "Mantenimiento de vehículos: fecha de servicio, vehículo, descripción, " +
    "costo y próximo servicio. Para reparaciones o service de la flota.",
  inputSchema: z.object({}),
  execute: () => runMaintenance(),
});

export async function runFleetDocuments(): Promise<AiToolResult> {
  const res = await listFleetDocumentsAction();
  if (!res.ok) return errResult(res.error);
  const today = new Date().toISOString().slice(0, 10);
  const expired = res.data.filter((d) => d.expires_at < today).length;
  return okResult(
    `${res.data.length} documentos de flota (VTV, seguro, licencias, etc.)` +
      `${expired > 0 ? ` · ${expired} vencidos` : ""}, ordenados por vencimiento.`,
    res.data,
  );
}

export const getFleetDocuments = tool({
  description:
    "Documentación de la flota (VTV, seguro, licencia de conducir, RTO, etc.) " +
    "con su fecha de vencimiento, del más próximo a vencer al último. Para " +
    "vencimientos de papeles de vehículos/choferes.",
  inputSchema: z.object({}),
  execute: () => runFleetDocuments(),
});

export async function runFleetProfitability(input: {
  periodStart: string;
  periodEnd: string;
}): Promise<AiToolResult> {
  if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd)) {
    return errResult("Rango de fechas inválido (usá AAAA-MM-DD).");
  }
  const res = await getFleetProfitabilityAction(input);
  if (!res.ok) return errResult(res.error);
  const { totals, trips, vehicles } = res.data;
  return okResult(
    `Rentabilidad de flota ${input.periodStart}→${input.periodEnd}: ` +
      `${trips.length} viajes, ${vehicles.length} vehículos · ` +
      `neto $${totals.net.toLocaleString("es-AR")} ` +
      `(facturación $${totals.revenue.toLocaleString("es-AR")} − costo $${totals.cost.toLocaleString(
        "es-AR",
      )}).`,
    res.data,
  );
}

export const getFleetProfitability = tool({
  description:
    "Rentabilidad de la flota en un rango de fechas: neto por viaje " +
    "(facturación − costo − combustible) y por vehículo (incluye mantenimiento). " +
    "Requiere fecha desde y hasta (AAAA-MM-DD). Para rentabilidad de viajes o " +
    "camiones.",
  inputSchema: z.object({
    periodStart: z.string().describe("Fecha desde, formato AAAA-MM-DD."),
    periodEnd: z.string().describe("Fecha hasta, formato AAAA-MM-DD."),
  }),
  execute: (input) => runFleetProfitability(input),
});
