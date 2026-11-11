import { z } from "zod";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { getClientSalesSummaryAction } from "@/features/clients/actions/sales-report-actions";
import { getDriverActivityAction } from "@/features/fleet-reports/actions/activity-actions";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import type { FleetMarginRow } from "@/features/fleet-reports/schema";
import {
  getManagementPnlAction,
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
import { SALES_INVOICE_DUE_DAYS } from "@/lib/aging";
import { round2 } from "@/lib/format";
import {
  IsoDateSchema,
  PeriodSchema,
  ScopeInputSchema,
} from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, money, okResult, type AiRunResult } from "../result";
import { readScope } from "../scope";

import { pendingFreightNote } from "./fleet";
import {
  INTERNAL_MODEL_NOTE,
  INTERNAL_NOTE,
  PNL_CAP_NOTE,
  monthsBetween,
} from "./management";

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
      `Vencido en pesos: comprobantes pasados de su vencimiento (${SALES_INVOICE_DUE_DAYS} días después de su fecha, salvo que traigan un vencimiento posterior). La deuda es la de hoy, no la del rango. Los dólares van aparte, con su equivalente en pesos al último oficial cuando hay cotización.`,
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
        modelNote:
          "open_ars_equivalent is the USD debt at the latest official rate, null when there is no rate.",
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

const FleetRangeInputSchema = z
  .object({ ...rangeShape, ...pageShape })
  .refine(rangeOrder, RANGE_ORDER_MESSAGE);

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
  ],
  description:
    "Actividad por chofer en un rango de fechas: viajes (no cancelados), km y viajes sin km, ingreso por flete, cargas todavía sin facturar y su flete (uninvoiced_shipments y uninvoiced_freight_ars; una carga por tarifa no tiene flete hasta facturarse: con uninvoiced_shipments > 0 ese neto no es definitivo), costo de viajes y combustible imputado, neto; del empleado vinculado: extras de planilla de los meses del rango, adelantos del rango (pesos y dólares) y saldo actual de su cuenta corriente en pesos. Ingresos y costos necesitan permiso de cargas y lo del empleado permiso de RRHH: lo que falta se omite y se avisa; un chofer sin empleado vinculado no tiene extras ni adelantos (null). Trae aparte los viajes sin chofer. Paginado (limit/offset).",
  input: FleetRangeInputSchema,
  run: async (ctx, input): Promise<AiRunResult> => {
    const range = { from: input.from, to: input.to };
    const withMoney = canReadFleetMoney(ctx.access);
    const withHr = userCan(ctx.access, "hr:read");
    const [activityRes, marginRes] = await Promise.all([
      getDriverActivityAction(range),
      withMoney
        ? getFleetMarginAction({
            ...range,
            groupBy: "driver",
            limit: READ_CAP,
          })
        : null,
    ]);
    if (!activityRes.ok) return errResult(activityRes.error);
    if (marginRes && !marginRes.ok) return errResult(marginRes.error);
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
          `${unlinked} choferes sin empleado vinculado: sin extras ni adelantos.`,
        );
      }
      notes.push(
        "Extras por mes de planilla (los meses que toca el rango); adelantos por fecha del movimiento; el saldo es el de hoy (positivo = el empleado debe).",
      );
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
      {
        currency: "ARS",
        partial: !complete,
        note: notes.join(" "),
        modelNote:
          "A driver with employee_linked false has null extras and advances.",
      },
    );
  },
});

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
      {
        currency: "ARS",
        partial: capped,
        note: notes.join(" "),
        modelNote: INTERNAL_MODEL_NOTE,
      },
    );
  },
});
