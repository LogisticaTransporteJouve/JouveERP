import { z } from "zod";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import {
  getClientNetRevenueAction,
  getClientSalesSummaryAction,
} from "@/features/clients/actions/sales-report-actions";
import {
  listCodPendingAction,
  listAllDriverSettlementsAction,
} from "@/features/driver-settlements/actions/driver-settlements-actions";
import type {
  CodPending,
  DriverSettlement,
} from "@/features/driver-settlements/schema";
import {
  getDriverActivityAction,
  getVehicleActivityAction,
} from "@/features/fleet-reports/actions/activity-actions";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import type {
  FleetMarginRow,
  VehicleActivityRow,
} from "@/features/fleet-reports/schema";
import {
  getManagementPnlAction,
  getVehicleMarginAction,
  listManagementCostCentersAction,
} from "@/features/management/actions/management-actions";
import {
  MANAGEMENT_BASES,
  SUBBUCKET_LABEL,
  type ManagementRow,
} from "@/features/management/schema";
import {
  CLIENT_AGING_PERMISSIONS,
  userCan,
  type Access,
} from "@/lib/auth/permissions";
import { periodEnd } from "@/lib/fiscal-year";
import { round2 } from "@/lib/format";
import {
  IsoDateSchema,
  PeriodSchema,
  ScopeInputSchema,
} from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, money, okResult, type AiRunResult } from "../result";
import { readScope } from "../scope";

import { maintenanceWithoutCostNote, pendingFreightNote } from "./fleet";
import { INTERNAL_NOTE, PNL_CAP_NOTE, monthsBetween } from "./management";

// Cross-domain reads (roadmap 6.1). Each composes read actions of the
// features it crosses; every part goes through that action's own gate and
// RLS, and a part the user cannot read is left out and named in the result
// (never shown as 0). Figures come from SQL; this only joins and pages them.

/** Rows each underlying read asks for; a read that reports more is partial. */
const READ_CAP = 500;

const pageShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullish()
    .describe("Filas por página (default 20, máximo 100)."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .nullish()
    .describe("Desde qué fila, para paginar (default 0)."),
};

const rangeShape = {
  from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
  to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
};

const rangeOrder = (v: { from: string; to: string }) => v.from <= v.to;
const RANGE_ORDER_MESSAGE = "La fecha desde es posterior a la fecha hasta.";

type Page<T> = {
  rows: T[];
  page: { offset: number; limit: number; total: number; hasMore: boolean };
};

/** One page of `rows`, with what the model needs to ask for the next one. */
export function pageOf<T>(
  rows: readonly T[],
  input: { limit?: number | null; offset?: number | null },
): Page<T> {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  const slice = rows.slice(offset, offset + limit);
  return {
    rows: slice,
    page: {
      offset,
      limit,
      total: rows.length,
      hasMore: offset + slice.length < rows.length,
    },
  };
}

function pageNote(page: Page<unknown>["page"]): string {
  return page.hasMore
    ? ` Se muestran ${page.offset + 1}–${page.offset + page.limit} de ${page.total}; pedí offset ${page.offset + page.limit} para seguir.`
    : "";
}

/** contribution / revenue in %, one decimal; null without revenue. */
function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

function canReadFleetMoney(access: Access): boolean {
  return userCan(access, "trips:read") && userCan(access, "shipments:read");
}

/** A fleet margin read: every group when total_groups fits the cap. */
function marginComplete(rows: readonly FleetMarginRow[]): boolean {
  return (rows[0]?.total_groups ?? 0) <= rows.length;
}

// ---------------------------------------------------------------------------
// Margin per client
// ---------------------------------------------------------------------------

const ClientMarginInputSchema = z
  .object({ ...rangeShape, scope: ScopeInputSchema, ...pageShape })
  .refine(rangeOrder, RANGE_ORDER_MESSAGE);

export const getClientMargin = defineAiAction({
  name: "getClientMargin",
  domain: "ventas",
  permission: ["clients:read", "invoices:read"],
  sideEffect: "read",
  sources: [
    "ai_client_net_revenue",
    "invoices",
    "ai_fleet_margin",
    "v_trip_revenue",
    "trips",
    "shipments",
    "fuel_loads",
    "maintenance_records",
  ],
  description:
    "Margen de contribución por cliente en un rango de fechas: ingreso neto facturado (facturas y ND menos NC, sin IVA ni tributos, por fecha del comprobante; moneda extranjera a la cotización del comprobante o la oficial de su fecha, y aparte si no tiene) menos los costos directos de sus viajes (costo del viaje + combustible imputado al viaje, por fecha del viaje, repartidos según el flete de cada carga; requiere permiso de viajes y cargas, si no se omiten y se avisa). uninvoiced_shipments: cargas sin facturar que afectan al cliente (las suyas, y las sin flete de otros clientes en sus viajes, que dejan abierto el reparto del costo): con más de 0 su margen no es definitivo y no hay que llamarlo pérdida. Dice cuánto costo directo quedó sin cliente (viajes sin cargas) y cuánto de flota no se asigna a clientes (combustible sin viaje, mantenimiento). No descuenta sueldos ni gastos generales: no es el margen neto. Paginado (limit/offset). Alcance opcional (fiscal/internal/all).",
  input: ClientMarginInputSchema,
  run: async (ctx, input): Promise<AiRunResult> => {
    const { label } = readScope(input.scope);
    const range = { from: input.from, to: input.to, scope: input.scope };
    const withCosts = canReadFleetMoney(ctx.access);
    const [revenueRes, byClientRes, byVehicleRes] = await Promise.all([
      getClientNetRevenueAction({ ...range, limit: READ_CAP }),
      withCosts
        ? getFleetMarginAction({ ...range, groupBy: "client", limit: READ_CAP })
        : null,
      withCosts
        ? getFleetMarginAction({
            ...range,
            groupBy: "vehicle",
            limit: READ_CAP,
          })
        : null,
    ]);
    if (!revenueRes.ok) return errResult(revenueRes.error);
    if (byClientRes && !byClientRes.ok) return errResult(byClientRes.error);
    if (byVehicleRes && !byVehicleRes.ok) return errResult(byVehicleRes.error);
    const revenue = revenueRes.data;
    const byClient = byClientRes?.data ?? null;
    const byVehicle = byVehicleRes?.data ?? null;

    type Acc = {
      client_id: string;
      client: string;
      net_revenue_ars: number;
      pending_foreign: number;
      trips: number | null;
      trip_cost_ars: number | null;
      fuel_cost_ars: number | null;
      uninvoiced_shipments: number | null;
    };
    const clients = new Map<string, Acc>();
    for (const r of revenue) {
      clients.set(r.client_id, {
        client_id: r.client_id,
        client: r.legal_name,
        net_revenue_ars: Number(r.net_revenue_ars),
        pending_foreign: Number(r.pending_foreign),
        trips: byClient ? 0 : null,
        trip_cost_ars: byClient ? 0 : null,
        fuel_cost_ars: byClient ? 0 : null,
        uninvoiced_shipments: byClient ? 0 : null,
      });
    }
    let withoutClient = 0;
    for (const g of byClient ?? []) {
      const direct = Number(g.trip_cost) + Number(g.fuel_cost);
      if (g.group_key === "none") {
        withoutClient += direct;
        continue;
      }
      // A client with trips but nothing invoiced in the range still shows,
      // with its costs and no revenue.
      const acc = clients.get(g.group_key) ?? {
        client_id: g.group_key,
        client: g.label,
        net_revenue_ars: 0,
        pending_foreign: 0,
        trips: 0,
        trip_cost_ars: 0,
        fuel_cost_ars: 0,
        uninvoiced_shipments: 0,
      };
      acc.trips = (acc.trips ?? 0) + g.trips;
      acc.trip_cost_ars = (acc.trip_cost_ars ?? 0) + Number(g.trip_cost);
      acc.fuel_cost_ars = (acc.fuel_cost_ars ?? 0) + Number(g.fuel_cost);
      acc.uninvoiced_shipments =
        (acc.uninvoiced_shipments ?? 0) + Number(g.uninvoiced_shipments);
      clients.set(g.group_key, acc);
    }

    const rows = [...clients.values()]
      .map((c) => {
        const direct =
          c.trip_cost_ars === null || c.fuel_cost_ars === null
            ? null
            : round2(c.trip_cost_ars + c.fuel_cost_ars);
        const contribution =
          direct === null ? null : round2(c.net_revenue_ars - direct);
        return {
          client_id: c.client_id,
          client: c.client,
          net_revenue_ars: round2(c.net_revenue_ars),
          trips: c.trips,
          trip_cost_ars:
            c.trip_cost_ars === null ? null : round2(c.trip_cost_ars),
          fuel_cost_ars:
            c.fuel_cost_ars === null ? null : round2(c.fuel_cost_ars),
          direct_cost_ars: direct,
          contribution_ars: contribution,
          contribution_pct:
            contribution === null ? null : pct(contribution, c.net_revenue_ars),
          pending_foreign: round2(c.pending_foreign),
          uninvoiced_shipments: c.uninvoiced_shipments,
        };
      })
      .sort(
        (a, b) =>
          b.net_revenue_ars - a.net_revenue_ars ||
          (b.contribution_ars ?? 0) - (a.contribution_ars ?? 0) ||
          a.client.localeCompare(b.client),
      );

    const first = revenue[0];
    const totalRevenue = Number(first?.total_net_revenue_ars ?? 0);
    const pendingForeign = Number(first?.total_pending_foreign ?? 0);
    const revenueComplete = (first?.total_clients ?? 0) <= revenue.length;
    const directTotal = byClient
      ? round2(
          rows.reduce((s, r) => s + (r.direct_cost_ars ?? 0), 0) +
            withoutClient,
        )
      : null;
    // Fleet cost no client carries: fuel loads without a trip and maintenance
    // (by vehicle), only when the vehicle read is whole.
    let fleetUnassigned: number | null = null;
    if (byClient && byVehicle && marginComplete(byVehicle)) {
      const vehicleFuel = byVehicle.reduce(
        (s, v) => s + Number(v.fuel_cost),
        0,
      );
      const maintenance = byVehicle.reduce(
        (s, v) => s + Number(v.maintenance_cost),
        0,
      );
      const tripFuel = byClient.reduce((s, g) => s + Number(g.fuel_cost), 0);
      fleetUnassigned = round2(vehicleFuel - tripFuel + maintenance);
    }
    const complete =
      revenueComplete &&
      (byClient === null || marginComplete(byClient)) &&
      (byVehicle === null || marginComplete(byVehicle));

    const page = pageOf(rows, input);
    const notes = [
      "Margen de contribución: no descuenta sueldos, mantenimiento, combustible sin viaje ni gastos generales. Ingresos por fecha de comprobante y costos por fecha de viaje: un viaje facturado en otro mes queda desfasado.",
    ];
    if (!byClient) {
      notes.push(
        "Costos directos omitidos: hacen falta los permisos de viajes y cargas (direct_cost_ars en null).",
      );
    }
    const notFinal = rows.filter((r) => (r.uninvoiced_shipments ?? 0) > 0);
    if (notFinal.length > 0) {
      notes.push(
        `${notFinal.length} cliente(s) con cargas sin facturar en sus viajes (uninvoiced_shipments): su margen no es definitivo, no es una pérdida.`,
      );
    }
    if (pendingForeign !== 0) {
      notes.push(
        `Hay comprobantes en moneda extranjera sin cotización (${pendingForeign}) que no se sumaron (pending_foreign).`,
      );
    }
    if (!complete) {
      notes.push(
        "Alguna lectura llegó a su tope: las cifras pueden estar incompletas.",
      );
    }
    return okResult(
      `${label}: margen por cliente ${input.from}→${input.to}: ${rows.length} clientes · ingreso neto ${money(totalRevenue)}` +
        (directTotal === null
          ? " · costos directos omitidos (sin permiso)."
          : ` · costos directos ${money(directTotal)} (sin cliente ${money(withoutClient)})` +
            (fleetUnassigned === null
              ? "."
              : ` · flota no asignada a clientes ${money(fleetUnassigned)}.`)) +
        pageNote(page.page),
      {
        rows: page.rows,
        totals: {
          net_revenue_ars: round2(totalRevenue),
          direct_cost_ars: directTotal,
          direct_cost_without_client_ars: byClient
            ? round2(withoutClient)
            : null,
          fleet_cost_not_assigned_ars: fleetUnassigned,
          pending_foreign: round2(pendingForeign),
        },
        page: page.page,
      },
      { currency: "ARS", partial: !complete, note: notes.join(" ") },
    );
  },
});

// ---------------------------------------------------------------------------
// Client payment behaviour
// ---------------------------------------------------------------------------

const PaymentBehaviorInputSchema = z
  .object({ ...rangeShape, scope: ScopeInputSchema, ...pageShape })
  .refine(rangeOrder, RANGE_ORDER_MESSAGE);

export const getClientPaymentBehavior = defineAiAction({
  name: "getClientPaymentBehavior",
  domain: "ventas",
  permission: CLIENT_AGING_PERMISSIONS,
  sideEffect: "read",
  sources: [
    "ai_client_sales_summary",
    "receipt_allocations",
    "v_client_aging",
    "v_aging_documents",
    "v_receipt_unapplied",
  ],
  description:
    "Cómo paga cada cliente — la tool para días de pago, cuánto tardan en pagarnos, atrasos y quién paga peor (no getClientSalesSummary, que es facturación): días promedio de cobro de lo cobrado en el rango (ponderado por lo imputado de cada recibo), cobrado por moneda, y su deuda actual: abierta en pesos y dólares (con el equivalente en pesos al último oficial), vencida en pesos, más de 90 días, días del comprobante más viejo, cheques rechazados y lo cobrado a cuenta sin imputar. Ordenado por deuda vencida. Un cliente sin cobros imputados en el rango no tiene promedio (null). Paginado (limit/offset). Alcance opcional (fiscal/internal/all).",
  input: PaymentBehaviorInputSchema,
  run: async (_ctx, input): Promise<AiRunResult> => {
    const { isFiscal, label } = readScope(input.scope);
    const [salesRes, agingRes] = await Promise.all([
      getClientSalesSummaryAction({
        from: input.from,
        to: input.to,
        scope: input.scope,
        limit: READ_CAP,
      }),
      getAgingSummaryAction({ isFiscal }),
    ]);
    if (!salesRes.ok) return errResult(salesRes.error);
    if (!agingRes.ok) return errResult(agingRes.error);
    const aging = new Map(agingRes.data.rows.map((r) => [r.id, r]));
    const ids = new Set([
      ...salesRes.data.map((r) => r.client_id),
      ...aging.keys(),
    ]);
    const sales = new Map(salesRes.data.map((r) => [r.client_id, r]));
    const rows = [...ids]
      .map((id) => {
        const s = sales.get(id);
        const a = aging.get(id);
        return {
          client_id: id,
          client: s?.legal_name ?? a?.legal_name ?? "",
          avg_days_to_pay:
            s?.avg_days_to_pay === null || s?.avg_days_to_pay === undefined
              ? null
              : Number(s.avg_days_to_pay),
          receipts_count: s?.receipts ?? 0,
          collected_ars: Number(s?.collected_ars ?? 0),
          collected_usd: Number(s?.collected_usd ?? 0),
          open_ars: a?.total.ars ?? 0,
          open_usd: a?.total.usd ?? 0,
          open_ars_equivalent: a ? a.total_ars_equivalent : 0,
          overdue_ars: Number(s?.overdue_ars ?? 0),
          bucket_90_plus_ars: a?.buckets["90_plus"].ars ?? 0,
          bucket_90_plus_usd: a?.buckets["90_plus"].usd ?? 0,
          oldest_days: a?.oldest_days ?? null,
          rejected_checks_ars: a?.rejected_checks.ars ?? 0,
          on_account_ars: a?.on_account.ars ?? 0,
        };
      })
      .sort(
        (x, y) =>
          y.overdue_ars - x.overdue_ars ||
          (y.open_ars_equivalent ?? 0) - (x.open_ars_equivalent ?? 0) ||
          x.client.localeCompare(y.client),
      );
    const first = salesRes.data[0];
    const salesComplete = (first?.total_clients ?? 0) <= salesRes.data.length;
    const t = agingRes.data.totals;
    const rate = agingRes.data.usd_rate;
    const overdue = rows.reduce((s, r) => s + r.overdue_ars, 0);
    const slow = rows.filter(
      (r) => r.avg_days_to_pay !== null && r.avg_days_to_pay > 60,
    ).length;
    const page = pageOf(rows, input);
    const notes = [
      "Vencido en pesos: comprobantes pasados de su vencimiento (o 30 días desde la fecha si no tiene). La deuda es la de hoy, no la del rango. Dólares aparte; open_ars_equivalent al último oficial (null si no hay cotización).",
    ];
    if (!salesComplete) {
      notes.push(
        `El resumen de cobros cubre ${salesRes.data.length} de ${first?.total_clients ?? 0} clientes.`,
      );
    }
    return okResult(
      `${label}: cobranza por cliente ${input.from}→${input.to}: ${rows.length} clientes · deuda abierta ${money(t.total.ars)}` +
        (t.total.usd !== 0 ? ` + US$${Math.round(t.total.usd)}` : "") +
        ` · vencida ${money(overdue)} · ${slow} clientes tardan más de 60 días en promedio.` +
        pageNote(page.page),
      { rows: page.rows, page: page.page, usd_rate: rate },
      {
        currency: "ARS",
        partial: !salesComplete,
        note: notes.join(" "),
        ...(rate
          ? {
              exchangeRate: {
                currency: "USD",
                rate: rate.rate,
                date: rate.rate_date,
              },
            }
          : {}),
      },
    );
  },
});

// ---------------------------------------------------------------------------
// Economics per vehicle
// ---------------------------------------------------------------------------

const FleetRangeInputSchema = z
  .object({ ...rangeShape, ...pageShape })
  .refine(rangeOrder, RANGE_ORDER_MESSAGE);

const VEHICLE_COSTS_NOTE =
  "Los costos por vehículo son los de sus viajes, sus cargas de combustible y sus registros de mantenimiento, más (con permiso de gestión) el costo operativo y lo sin clasificar cargados con el centro de costo vinculado al camión (seguros, patentes, cubiertas, compras), sin contar dos veces lo que ya imputa una carga o un service.";

const UNLINKED_VEHICLE_COSTS =
  "Seguros, patentes, cubiertas y compras cargadas solo con centro de costo no entran: hace falta el permiso de gestión.";

/** Whole months a date range touches, for the cost-center part. */
function periodsOf(range: { from: string; to: string }): {
  fromPeriod: string;
  toPeriod: string;
  aligned: boolean;
} {
  const fromPeriod = range.from.slice(0, 7);
  const toPeriod = range.to.slice(0, 7);
  return {
    fromPeriod,
    toPeriod,
    aligned: range.from.endsWith("-01") && range.to === periodEnd(toPeriod),
  };
}

/** The km a per-km figure divides by: the odometer when both readings are
 *  loaded, else the trips' km (incomplete when some trip has no km). */
export function kmBasis(row: {
  odometer_km: number | null;
  trip_km: number;
  trips_without_km_count: number;
}): { km: number | null; source: string | null } {
  if (row.odometer_km !== null && row.odometer_km > 0) {
    return { km: row.odometer_km, source: "odómetro" };
  }
  if (row.trip_km > 0) {
    return {
      km: row.trip_km,
      source: row.trips_without_km_count > 0 ? "viajes (incompleto)" : "viajes",
    };
  }
  return { km: null, source: null };
}

function perKm(amount: number | null, km: number | null): number | null {
  return amount === null || km === null || km <= 0 ? null : round2(amount / km);
}

export const getVehicleEconomics = defineAiAction({
  name: "getVehicleEconomics",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: [
    "ai_vehicle_activity",
    "ai_fleet_margin",
    "trips",
    "v_trip_revenue",
    "fuel_loads",
    "maintenance_records",
    "vehicle_km_readings",
    "get_vehicle_margin",
    "cost_centers",
  ],
  description:
    "Economía por camión/vehículo en un rango de fechas: viajes (no cancelados), km de viajes y de odómetro (lectura mensual del último mes menos la del mes anterior al primero), litros de combustible y litros cada 100 km, ingreso por flete, costo de viajes, combustible, mantenimiento, costo del centro de costo del camión (seguros, patentes, cubiertas y compras cargadas con ese centro, por meses completos), neto, margen % e ingreso y costo por km. uninvoiced_shipments cuenta sus cargas todavía sin facturar y uninvoiced_freight_ars es su flete (una carga por tarifa no tiene flete hasta facturarse, así que puede ser 0): no están en el ingreso, así que con uninvoiced_shipments > 0 ese neto no es definitivo y no es pérdida todavía. maintenance_without_cost cuenta los services sin costo cargado (no están en el mantenimiento). Cada parte necesita su permiso (cargas para ingresos y costos, combustible para litros, km de flota para el odómetro, gestión para el centro de costo): lo que falta se omite y se avisa. Trae aparte los viajes sin vehículo y el costo operativo que no es de ningún camión (no se reparte). Paginado (limit/offset).",
  input: FleetRangeInputSchema,
  run: async (ctx, input): Promise<AiRunResult> => {
    const range = { from: input.from, to: input.to };
    const withMoney = canReadFleetMoney(ctx.access);
    const withCenters = withMoney && userCan(ctx.access, "management:read");
    const periods = periodsOf(range);
    const [activityRes, marginRes, centerRes] = await Promise.all([
      getVehicleActivityAction(range),
      withMoney
        ? getFleetMarginAction({
            ...range,
            groupBy: "vehicle",
            limit: READ_CAP,
          })
        : null,
      withCenters
        ? getVehicleMarginAction({
            fromPeriod: periods.fromPeriod,
            toPeriod: periods.toPeriod,
          })
        : null,
    ]);
    if (!activityRes.ok) return errResult(activityRes.error);
    if (marginRes && !marginRes.ok) return errResult(marginRes.error);
    if (centerRes && !centerRes.ok) return errResult(centerRes.error);
    const margin = new Map(
      (marginRes?.data ?? []).map((m) => [m.group_key, m]),
    );
    const centers = new Map(
      (centerRes?.data.vehicles ?? []).map((v) => [v.vehicleId, v]),
    );
    const activity = activityRes.data.filter((a) => a.vehicle_id !== null);
    const unassigned = activityRes.data.find((a) => a.vehicle_id === null);
    const withFuel = userCan(ctx.access, "fuel:read");
    const withKm = userCan(ctx.access, "fleet_km:read");

    const seen = new Set<string>();
    const merged: {
      id: string;
      label: string;
      a: VehicleActivityRow | undefined;
      m: FleetMarginRow | undefined;
    }[] = activity.map((a) => {
      seen.add(a.vehicle_id);
      return {
        id: a.vehicle_id,
        label: a.patente,
        a,
        m: margin.get(a.vehicle_id),
      };
    });
    // A vehicle with only maintenance in the range (inactive, no trips).
    // The trips without a vehicle (group none) come apart, from activity.
    for (const m of marginRes?.data ?? []) {
      if (m.group_key !== "none" && !seen.has(m.group_key)) {
        seen.add(m.group_key);
        merged.push({ id: m.group_key, label: m.label, a: undefined, m });
      }
    }
    // A truck with only costs of its cost center (insurance, patente).
    for (const c of centers.values()) {
      if (c.vehicleId && !seen.has(c.vehicleId) && c.centerCost !== 0) {
        seen.add(c.vehicleId);
        merged.push({
          id: c.vehicleId,
          label: c.patente ?? c.vehicleId,
          a: undefined,
          m: undefined,
        });
      }
    }

    const rows = merged
      .map(({ id, label, a, m }) => {
        const tripKm = Number(a?.trip_km ?? 0);
        const withoutKm = a?.trips_without_km ?? 0;
        const odometer =
          a?.odometer_km === null || a?.odometer_km === undefined
            ? null
            : Number(a.odometer_km);
        const basis = kmBasis({
          odometer_km: odometer,
          trip_km: tripKm,
          trips_without_km_count: withoutKm,
        });
        const liters =
          a?.fuel_liters === null || a?.fuel_liters === undefined
            ? null
            : Number(a.fuel_liters);
        const center = centers.get(id);
        const centerCost = withCenters ? (center?.centerCost ?? 0) : null;
        const revenue = withMoney ? Number(m?.revenue ?? 0) : null;
        const cost = withMoney
          ? Number(m?.trip_cost ?? 0) +
            Number(m?.fuel_cost ?? 0) +
            Number(m?.maintenance_cost ?? 0) +
            (centerCost ?? 0)
          : null;
        const net = withMoney
          ? round2(Number(m?.net ?? 0) - (centerCost ?? 0))
          : null;
        return {
          vehicle_id: id,
          vehicle: label,
          active: a?.is_active ?? null,
          trips: a?.trips ?? 0,
          trip_km: tripKm,
          trips_without_km_count: withoutKm,
          odometer_km: odometer,
          km_used: basis.km,
          km_source: basis.source,
          fuel_liters: liters,
          liters_per_100km:
            liters !== null && basis.km !== null && basis.km > 0
              ? round2((liters / basis.km) * 100)
              : null,
          revenue_ars: revenue,
          uninvoiced_freight_ars: withMoney
            ? Number(m?.uninvoiced_freight ?? 0)
            : null,
          uninvoiced_shipments: withMoney
            ? Number(m?.uninvoiced_shipments ?? 0)
            : null,
          trip_cost_ars: withMoney ? Number(m?.trip_cost ?? 0) : null,
          fuel_cost_ars: withMoney ? Number(m?.fuel_cost ?? 0) : null,
          maintenance_cost_ars: withMoney
            ? Number(m?.maintenance_cost ?? 0)
            : null,
          maintenance_without_cost: withMoney
            ? Number(m?.maintenance_without_cost ?? 0)
            : null,
          cost_center_linked: withCenters
            ? (center?.costCenterId ?? null) !== null
            : null,
          cost_center_cost_ars: centerCost,
          net_ars: net,
          margin_pct:
            revenue === null || net === null ? null : pct(net, revenue),
          revenue_per_km_ars: perKm(revenue, basis.km),
          cost_per_km_ars: perKm(cost, basis.km),
        };
      })
      .sort(
        (x, y) =>
          (y.net_ars ?? 0) - (x.net_ars ?? 0) ||
          y.trips - x.trips ||
          x.vehicle.localeCompare(y.vehicle),
      );

    const activityCapped = activityRes.data.length > READ_CAP;
    const complete =
      !activityCapped &&
      (marginRes === null || marginComplete(marginRes.data)) &&
      !(centerRes?.data.partial ?? false);
    const page = pageOf(rows.slice(0, READ_CAP), input);
    const omitted = [
      withMoney ? null : "ingresos y costos (permiso de cargas)",
      withFuel ? null : "litros (permiso de combustible)",
      withKm ? null : "km de odómetro (permiso de km de flota)",
    ].filter((x): x is string => x !== null);
    const notes = [VEHICLE_COSTS_NOTE];
    if (withMoney && !withCenters) notes.push(UNLINKED_VEHICLE_COSTS);
    const vehicleTotals = marginRes?.data[0];
    const vehiclePending = pendingFreightNote({
      amount: Number(vehicleTotals?.total_uninvoiced_freight ?? 0),
      shipments: Number(vehicleTotals?.total_uninvoiced_shipments ?? 0),
    });
    if (vehiclePending) notes.push(vehiclePending);
    const vehicleNoCost = maintenanceWithoutCostNote(
      Number(vehicleTotals?.total_maintenance_without_cost ?? 0),
    );
    if (vehicleNoCost) notes.push(vehicleNoCost);
    if (omitted.length)
      notes.push(`Omitido por permisos: ${omitted.join(", ")}.`);
    const unattributedCost = centerRes
      ? round2(
          centerRes.data.unattributed.reduce((s, u) => s + u.centerCost, 0),
        )
      : null;
    if (centerRes) {
      const unlinked = rows.filter((r) => r.cost_center_linked === false);
      if (unlinked.length > 0) {
        notes.push(
          `${unlinked.length} vehículos sin centro de costo vinculado: solo llevan viajes, combustible y mantenimiento.`,
        );
      }
      if (!periods.aligned) {
        notes.push(
          `El costo del centro de cada camión es de los meses completos ${periods.fromPeriod}→${periods.toPeriod}; el resto, del rango exacto.`,
        );
      }
      notes.push(
        `Costo operativo sin camión (otros centros y sin centro, no repartido): ${money(unattributedCost ?? 0)}.`,
      );
    }
    const noOdometer = rows.filter((r) => r.odometer_km === null).length;
    if (withKm && noOdometer > 0) {
      notes.push(
        `${noOdometer} vehículos sin las dos lecturas de odómetro: por km se usan los km de viajes (km_source).`,
      );
    }
    if (!complete) {
      notes.push(
        "Alguna lectura llegó a su tope: las cifras pueden estar incompletas.",
      );
    }
    const totalNet = rows.reduce((s, r) => s + (r.net_ars ?? 0), 0);
    return okResult(
      `Vehículos ${input.from}→${input.to}: ${rows.length} con actividad` +
        (withMoney ? ` · neto ${money(totalNet)}` : "") +
        (unassigned
          ? ` · ${unassigned.trips} viajes sin vehículo` +
            (unassigned.unassigned_revenue === null
              ? ""
              : ` (ingreso ${money(Number(unassigned.unassigned_revenue))})`)
          : "") +
        "." +
        pageNote(page.page),
      {
        rows: page.rows,
        withoutVehicle: unassigned
          ? {
              trips: unassigned.trips,
              trip_km: Number(unassigned.trip_km),
              revenue_ars:
                unassigned.unassigned_revenue === null
                  ? null
                  : Number(unassigned.unassigned_revenue),
            }
          : null,
        unattributed_cost_ars: unattributedCost,
        page: page.page,
      },
      { currency: "ARS", partial: !complete, note: notes.join(" ") },
    );
  },
});

// ---------------------------------------------------------------------------
// Activity per driver
// ---------------------------------------------------------------------------

export const getDriverActivity = defineAiAction({
  name: "getDriverActivity",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: [
    "ai_driver_activity",
    "ai_fleet_margin",
    "trips",
    "v_trip_revenue",
    "v_payroll_entries_resolved",
    "employee_account_movements",
    "v_employee_account_balances",
    "driver_settlements",
    "driver_settlement_items",
    "driver_settlement_lines",
    "shipments",
  ],
  description:
    "Actividad por chofer en un rango de fechas: viajes (no cancelados), km y viajes sin km, ingreso por flete, cargas todavía sin facturar y su flete (uninvoiced_shipments y uninvoiced_freight_ars; una carga por tarifa no tiene flete hasta facturarse: con uninvoiced_shipments > 0 ese neto no es definitivo), costo de viajes y combustible imputado, neto; del empleado vinculado: extras de planilla de los meses del rango, adelantos del rango (pesos y dólares) y saldo actual de su cuenta corriente en pesos; y sus rendiciones de cobranza contra entrega: lo pendiente hoy (cargas entregadas sin rendir y rendiciones en borrador) y las confirmadas del rango con lo esperado, lo entregado y la diferencia (entregado − esperado; negativo = faltante). Ingresos y costos necesitan permiso de cargas, lo del empleado permiso de RRHH y las rendiciones permiso de recibos: lo que falta se omite y se avisa; un chofer sin empleado vinculado no tiene extras ni adelantos (null). Trae aparte los viajes sin chofer. Paginado (limit/offset).",
  input: FleetRangeInputSchema,
  run: async (ctx, input): Promise<AiRunResult> => {
    const range = { from: input.from, to: input.to };
    const withMoney = canReadFleetMoney(ctx.access);
    const withHr = userCan(ctx.access, "hr:read");
    const withCod = userCan(ctx.access, "receipts:read");
    const [activityRes, marginRes, pendingRes, settlementsRes] =
      await Promise.all([
        getDriverActivityAction(range),
        withMoney
          ? getFleetMarginAction({
              ...range,
              groupBy: "driver",
              limit: READ_CAP,
            })
          : null,
        withCod ? listCodPendingAction() : null,
        withCod ? listAllDriverSettlementsAction() : null,
      ]);
    if (!activityRes.ok) return errResult(activityRes.error);
    if (marginRes && !marginRes.ok) return errResult(marginRes.error);
    if (pendingRes && !pendingRes.ok) return errResult(pendingRes.error);
    if (settlementsRes && !settlementsRes.ok)
      return errResult(settlementsRes.error);
    const cod =
      pendingRes && settlementsRes
        ? codByDriver(pendingRes.data, settlementsRes.data.settlements, range)
        : null;
    const margin = new Map(
      (marginRes?.data ?? []).map((m) => [m.group_key, m]),
    );
    const num = (v: number | null | undefined) =>
      v === null || v === undefined ? null : Number(v);
    const unassigned = activityRes.data.find((a) => a.driver_id === null);
    const rows = activityRes.data
      .filter((a) => a.driver_id !== null)
      .map((a) => {
        const m = margin.get(a.driver_id);
        return {
          driver_id: a.driver_id,
          driver: a.full_name,
          active: a.is_active,
          employee_linked: a.employee_id !== null,
          trips: a.trips,
          trip_km: Number(a.trip_km),
          trips_without_km_count: a.trips_without_km,
          revenue_ars: withMoney ? Number(m?.revenue ?? 0) : null,
          uninvoiced_freight_ars: withMoney
            ? Number(m?.uninvoiced_freight ?? 0)
            : null,
          uninvoiced_shipments: withMoney
            ? Number(m?.uninvoiced_shipments ?? 0)
            : null,
          trip_cost_ars: withMoney ? Number(m?.trip_cost ?? 0) : null,
          fuel_cost_ars: withMoney ? Number(m?.fuel_cost ?? 0) : null,
          net_ars: withMoney ? Number(m?.net ?? 0) : null,
          extras_ars: num(a.extras_ars),
          advances_ars: num(a.advances_ars),
          advances_usd: num(a.advances_usd),
          account_balance_ars: num(a.account_balance_ars),
          ...codFields(cod?.get(a.driver_id), cod !== null),
        };
      })
      .sort(
        (x, y) =>
          y.trips - x.trips ||
          (y.revenue_ars ?? 0) - (x.revenue_ars ?? 0) ||
          x.driver.localeCompare(y.driver),
      );
    const complete =
      activityRes.data.length <= READ_CAP &&
      (marginRes === null || marginComplete(marginRes.data));
    const page = pageOf(rows.slice(0, READ_CAP), input);
    const notes: string[] = [];
    if (!withMoney) {
      notes.push(
        "Ingresos y costos omitidos: hace falta el permiso de cargas.",
      );
    }
    const driverPending = pendingFreightNote({
      amount: Number(marginRes?.data[0]?.total_uninvoiced_freight ?? 0),
      shipments: Number(marginRes?.data[0]?.total_uninvoiced_shipments ?? 0),
    });
    if (driverPending) notes.push(driverPending);
    if (!withHr) {
      notes.push(
        "Extras, adelantos y cuenta corriente omitidos: hace falta el permiso de RRHH.",
      );
    } else {
      const unlinked = rows.filter((r) => !r.employee_linked).length;
      if (unlinked > 0) {
        notes.push(
          `${unlinked} choferes sin empleado vinculado: sin extras ni adelantos (null).`,
        );
      }
      notes.push(
        "Extras por mes de planilla (los meses que toca el rango); adelantos por fecha del movimiento; el saldo es el de hoy (positivo = el empleado debe).",
      );
    }
    if (!withCod) {
      notes.push(
        "Rendiciones de cobranza contra entrega omitidas: hace falta el permiso de recibos.",
      );
    } else if (cod) {
      notes.push(
        "Rendiciones: lo pendiente es de hoy (cargas entregadas contra entrega sin rendir y borradores); las confirmadas, por fecha de rendición en el rango; diferencia = entregado − esperado.",
      );
      const listed = new Set(rows.map((r) => r.driver_id));
      const others = [...cod.entries()].filter(([id]) => !listed.has(id));
      const othersPending = round2(
        others.reduce((s, [, c]) => s + c.pendingArs + c.draftArs, 0),
      );
      if (othersPending !== 0) {
        notes.push(
          `Cobranza pendiente de choferes fuera de la lista o sin chofer: ${money(othersPending)}.`,
        );
      }
    }
    const noneMoney = margin.get("none");
    if (unassigned || noneMoney) {
      notes.push(
        `Viajes sin chofer: ${unassigned?.trips ?? 0}` +
          (noneMoney ? `, ingreso ${money(Number(noneMoney.revenue))}.` : "."),
      );
    }
    if (!complete) {
      notes.push(
        "Alguna lectura llegó a su tope: las cifras pueden estar incompletas.",
      );
    }
    const trips = rows.reduce((s, r) => s + r.trips, 0);
    const km = rows.reduce((s, r) => s + r.trip_km, 0);
    return okResult(
      `Choferes ${input.from}→${input.to}: ${rows.length} · ${trips} viajes · ${Math.round(km).toLocaleString("es-AR")} km.` +
        pageNote(page.page),
      {
        rows: page.rows,
        withoutDriver: unassigned
          ? {
              trips: unassigned.trips,
              trip_km: Number(unassigned.trip_km),
              revenue_ars: noneMoney ? Number(noneMoney.revenue) : null,
            }
          : null,
        page: page.page,
      },
      { currency: "ARS", partial: !complete, note: notes.join(" ") },
    );
  },
});

type DriverCod = {
  pendingCargas: number;
  pendingArs: number;
  drafts: number;
  draftArs: number;
  settled: number;
  settledExpectedArs: number;
  settledReceivedArs: number;
  settledDifferenceArs: number;
};

const NO_DRIVER = "none";

/** Cash on delivery per driver ("none" = cargas of a trip without one):
 *  what is pending today and the rendiciones confirmed in the range. */
export function codByDriver(
  pending: CodPending,
  settlements: readonly DriverSettlement[],
  range: { from: string; to: string },
): Map<string, DriverCod> {
  const out = new Map<string, DriverCod>();
  const get = (id: string | null) => {
    const key = id ?? NO_DRIVER;
    const row = out.get(key) ?? {
      pendingCargas: 0,
      pendingArs: 0,
      drafts: 0,
      draftArs: 0,
      settled: 0,
      settledExpectedArs: 0,
      settledReceivedArs: 0,
      settledDifferenceArs: 0,
    };
    out.set(key, row);
    return row;
  };
  for (const p of pending.byDriver) {
    const row = get(p.driver_id);
    row.pendingCargas += p.cargas;
    row.pendingArs = round2(row.pendingArs + p.amount);
  }
  for (const s of settlements) {
    if (s.status === "draft") {
      const row = get(s.driver_id);
      row.drafts += 1;
      row.draftArs = round2(row.draftArs + s.expected_total);
    } else if (
      s.status === "confirmed" &&
      s.settlement_date >= range.from &&
      s.settlement_date <= range.to
    ) {
      const row = get(s.driver_id);
      row.settled += 1;
      row.settledExpectedArs = round2(
        row.settledExpectedArs + s.expected_total,
      );
      row.settledReceivedArs = round2(
        row.settledReceivedArs + s.received_total,
      );
      row.settledDifferenceArs = round2(
        row.settledDifferenceArs + s.difference,
      );
    }
  }
  return out;
}

/** A driver's cash-on-delivery fields; all null without receipts:read. */
function codFields(c: DriverCod | undefined, readable: boolean) {
  if (!readable) {
    return {
      cod_pending_cargas: null,
      cod_pending_ars: null,
      cod_draft_settlements: null,
      cod_draft_ars: null,
      cod_settlements: null,
      cod_settled_expected_ars: null,
      cod_settled_received_ars: null,
      cod_settled_difference_ars: null,
    };
  }
  return {
    cod_pending_cargas: c?.pendingCargas ?? 0,
    cod_pending_ars: c?.pendingArs ?? 0,
    cod_draft_settlements: c?.drafts ?? 0,
    cod_draft_ars: c?.draftArs ?? 0,
    cod_settlements: c?.settled ?? 0,
    cod_settled_expected_ars: c?.settledExpectedArs ?? 0,
    cod_settled_received_ars: c?.settledReceivedArs ?? 0,
    cod_settled_difference_ars: c?.settledDifferenceArs ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Top costs by category or cost center
// ---------------------------------------------------------------------------

const TOP_COSTS_GROUPS = ["category", "costCenter"] as const;

/** Series of the stacked month table: the largest groups, the rest in one. */
const MONTH_SERIES = 5;

const TopCostsInputSchema = z
  .object({
    fromPeriod: PeriodSchema.describe("Período desde, YYYY-MM."),
    toPeriod: PeriodSchema.describe("Período hasta, YYYY-MM (inclusive)."),
    basis: z
      .enum(MANAGEMENT_BASES)
      .default("accrual")
      .describe("'accrual' (devengado, default) o 'cash' (percibido)."),
    groupBy: z
      .enum(TOP_COSTS_GROUPS)
      .default("category")
      .describe(
        "'category' (rubro de costo: sueldos, combustible, seguros…) o 'costCenter' (camión, depósito, administración).",
      ),
    includeFinancing: z
      .boolean()
      .default(true)
      .describe("Sumar el costo financiero (intereses, cargos). Default true."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .nullish()
      .describe("Cuántos mostrar (default 10); el resto va en una fila."),
  })
  .refine((v) => v.fromPeriod <= v.toPeriod, "Rango de períodos invertido.");

type CostGroup = { key: string; label: string; rows: ManagementRow[] };

/** The cost rows of the P&L grouped, each with its cost as a positive
 *  amount (a refund that outweighs the cost leaves it negative). */
export function groupCosts(
  rows: readonly ManagementRow[],
  groupBy: (typeof TOP_COSTS_GROUPS)[number],
  includeFinancing: boolean,
  centerName: (id: string | null) => string,
): {
  key: string;
  label: string;
  cost: number;
  byMonth: Map<string, number>;
}[] {
  const groups = new Map<string, CostGroup>();
  for (const r of rows) {
    const isCost =
      r.bucket === "operating_cost" ||
      (includeFinancing && r.bucket === "financing_cost");
    if (!isCost) continue;
    const sub = r.subbucket ?? (r.bucket === "operating_cost" ? "otros" : null);
    const key =
      groupBy === "category"
        ? (sub ?? "financing")
        : (r.costCenterId ?? "none");
    const label =
      groupBy === "category"
        ? sub
          ? SUBBUCKET_LABEL[sub]
          : "Costo financiero (otros)"
        : centerName(r.costCenterId);
    const g = groups.get(key) ?? { key, label, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const byMonth = new Map<string, number>();
      for (const r of g.rows) {
        byMonth.set(r.month, (byMonth.get(r.month) ?? 0) - r.amount);
      }
      return {
        key: g.key,
        label: g.label,
        cost: round2(g.rows.reduce((s, r) => s - r.amount, 0)),
        byMonth,
      };
    })
    .sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label));
}

/** A plain row key for a group ("cost_combustible"). */
function seriesField(key: string): string {
  return `cost_${key.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 60);
}

export const getTopCosts = defineAiAction({
  name: "getTopCosts",
  domain: "contabilidad",
  permission: "management:read",
  sideEffect: "read",
  sources: [
    "get_management_pnl",
    "journal_entry_lines",
    "management_buckets",
    "cost_centers",
  ],
  description:
    "Ranking de costos (uso interno) en un rango de meses, por rubro (sueldos, combustible, mantenimiento, seguros, peajes, alquileres, impuestos, administración, proveedores, costo financiero…) o por centro de costo, en devengado o percibido: costo de cada uno, % del total y el resto en una fila. Sale del resultado de gestión (fiscal + interno). Trae también byMonth: una fila por mes con los 5 mayores y el resto, para un gráfico apilado (renderChart type 'stacked', dataset 'byMonth'; series en seriesFields). Las cuentas de resultado sin clasificar y los USD sin cotización van aparte.",
  input: TopCostsInputSchema,
  run: async (_ctx, input): Promise<AiRunResult> => {
    const [res, centersRes] = await Promise.all([
      getManagementPnlAction({
        fromPeriod: input.fromPeriod,
        toPeriod: input.toPeriod,
        basis: input.basis,
        inflation: false,
      }),
      input.groupBy === "costCenter" ? listManagementCostCentersAction() : null,
    ]);
    if (!res.ok) return errResult(res.error);
    if (centersRes && !centersRes.ok) return errResult(centersRes.error);
    const names = new Map(
      (centersRes?.data ?? []).map((c) => [c.id, `${c.code} · ${c.name}`]),
    );
    const centerName = (id: string | null) =>
      id === null ? "Sin centro" : (names.get(id) ?? "Centro eliminado");
    const months = monthsBetween(input.fromPeriod, input.toPeriod);
    const inRange = res.data.rows.filter((r) => months.includes(r.month));
    const groups = groupCosts(
      inRange,
      input.groupBy,
      input.includeFinancing,
      centerName,
    );
    const total = round2(groups.reduce((s, g) => s + g.cost, 0));
    const limit = input.limit ?? 10;
    const top = groups.slice(0, limit);
    const rest = groups.slice(limit);
    const restCost = round2(rest.reduce((s, g) => s + g.cost, 0));
    const rows = [
      ...top.map((g) => ({
        name: g.label,
        cost_ars: g.cost,
        share_pct: pct(g.cost, total),
        key: g.key,
      })),
      ...(rest.length
        ? [
            {
              name: `Resto (${rest.length})`,
              cost_ars: restCost,
              share_pct: pct(restCost, total),
              key: "rest",
            },
          ]
        : []),
    ];
    const series = groups.slice(0, MONTH_SERIES);
    const others = groups.slice(MONTH_SERIES);
    const seriesFields = [
      ...series.map((g) => ({ field: seriesField(g.key), label: g.label })),
      ...(others.length ? [{ field: "cost_rest", label: "Resto" }] : []),
    ];
    const byMonth = months.map((month) => ({
      month,
      ...Object.fromEntries(
        series.map((g) => [
          seriesField(g.key),
          round2(g.byMonth.get(month) ?? 0),
        ]),
      ),
      ...(others.length
        ? {
            cost_rest: round2(
              others.reduce((s, g) => s + (g.byMonth.get(month) ?? 0), 0),
            ),
          }
        : {}),
    }));
    const unclassified = round2(
      inRange
        .filter((r) => r.bucket === "unclassified")
        .reduce((s, r) => s + r.amount, 0),
    );
    const pendingUsd = round2(inRange.reduce((s, r) => s + r.pendingUsd, 0));
    const capped = res.data.partial;
    const notes = [INTERNAL_NOTE];
    if (unclassified !== 0) {
      notes.push(
        `Cuentas de resultado sin clasificar: ${money(unclassified)} (con signo), fuera del ranking.`,
      );
    }
    if (pendingUsd !== 0) {
      notes.push(
        `USD sin pasar a pesos (sin cotización o, si son fiscales, sin asiento) no sumados: US$${pendingUsd}.`,
      );
    }
    if (capped) notes.push(PNL_CAP_NOTE);
    const head = top
      .slice(0, 3)
      .map((g) => `${g.label} ${money(g.cost)} (${pct(g.cost, total) ?? 0} %)`)
      .join(", ");
    return okResult(
      `Costos ${input.fromPeriod}→${input.toPeriod} por ${input.groupBy === "category" ? "rubro" : "centro de costo"} (uso interno, ${input.basis === "cash" ? "percibido" : "devengado"}): total ${money(total)} en ${groups.length} grupos · ${head || "sin costos"}.`,
      { rows, byMonth, seriesFields, total_cost_ars: total },
      { currency: "ARS", partial: capped, note: notes.join(" ") },
    );
  },
});
