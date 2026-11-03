import { z } from "zod";

import {
  getManagementDrillAction,
  getManagementPnlAction,
  listManagementCostCentersAction,
} from "@/features/management/actions/management-actions";
import {
  ALL_COST_CENTERS,
  DOC_TYPE_LABEL,
  MANAGEMENT_BASES,
  NO_COST_CENTER,
  SIDE_VIEWS,
  TABLE_LINES,
  buildMonthTable,
  computeKpis,
  computeWaterfall,
  costCenterBreakdown,
  filterByCostCenter,
  shiftPeriod,
} from "@/features/management/schema";
import { PeriodSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, money, okResult, type AiRunResult } from "../result";

const INTERNAL_NOTE =
  "Resultado de gestión: USO INTERNO (fiscal + interno). No es el EERR fiscal: para bancos, ARCA o cualquier tercero usar getIncomeStatement / getBalanceSheet.";

const ManagementPnlToolInputSchema = z
  .object({
    fromPeriod: PeriodSchema.describe("Período desde, YYYY-MM."),
    toPeriod: PeriodSchema.describe("Período hasta, YYYY-MM (inclusive)."),
    basis: z
      .enum(MANAGEMENT_BASES)
      .default("accrual")
      .describe(
        "'accrual' (devengado, por mes de comprobante y de liquidación de sueldos) o 'cash' (percibido, por fecha de cobro/pago).",
      ),
    costCenterId: z
      .union([z.string().uuid(), z.literal(NO_COST_CENTER)])
      .nullish()
      .describe(
        "Opcional: UUID de un centro de costo (ver getCostCenters) para ver solo su resultado, o 'none' para lo cargado sin centro. Sin valor: todos.",
      ),
  })
  .refine((v) => v.fromPeriod <= v.toPeriod, "Rango de períodos invertido.");

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (;;) {
    const p = `${y}-${String(m).padStart(2, "0")}`;
    if (p > to) break;
    out.push(p);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const MANAGEMENT_LINE_KEYS = TABLE_LINES.map((l) => l.key);

export const getManagementPnL = defineAiAction({
  name: "getManagementPnL",
  domain: "contabilidad",
  permission: "management:read",
  sideEffect: "read",
  sources: [
    "get_management_pnl",
    "journal_entry_lines",
    "journal_document_entry",
    "management_buckets",
    "cost_centers",
  ],
  description:
    "Resultado de gestión (uso interno): ¿la operación deja plata? Suma lo fiscal y lo interno en una cascada (servicios, costos operativos con sueldos y sueldos internos (extras) aparte, margen operativo, costo financiero, capital de préstamos, inversión en flota, venta de bienes de uso, anticipos al personal (solo percibido), generación de caja), la tabla por mes, la apertura por centro de costo (camión, depósito, administración; lo cargado sin centro va aparte), con filtro opcional por un centro, y los indicadores (margen operativo %, resultado operativo tipo EBITDA, generación de caja) contra los mismos meses del año anterior. Las compras a cargo de empleados y los adelantos no son costo operativo en ninguna base: el costo aparece cuando la planilla los descuenta. Para ver qué comprobantes forman una cifra usar getManagementPnLDocuments. Gestión = uso interno; para bancos/ARCA usar el EERR fiscal (getIncomeStatement) o el balance (getBalanceSheet). Nunca ofrecer estos datos para presentar a terceros.",
  input: ManagementPnlToolInputSchema,
  run: async (_ctx, input): Promise<AiRunResult> => {
    const [res, previousRes, centersRes] = await Promise.all([
      getManagementPnlAction({
        fromPeriod: input.fromPeriod,
        toPeriod: input.toPeriod,
        basis: input.basis,
        inflation: false,
      }),
      getManagementPnlAction({
        fromPeriod: shiftPeriod(input.fromPeriod, -1),
        toPeriod: shiftPeriod(input.toPeriod, -1),
        basis: input.basis,
        inflation: false,
      }),
      listManagementCostCentersAction(),
    ]);
    if (!res.ok) return errResult(res.error);
    if (!previousRes.ok) return errResult(previousRes.error);
    if (!centersRes.ok) return errResult(centersRes.error);
    const names = new Map(
      centersRes.data.map((c) => [c.id, `${c.code} · ${c.name}`]),
    );
    const rows = filterByCostCenter(
      res.data,
      input.costCenterId ?? ALL_COST_CENTERS,
    );
    const waterfall = computeWaterfall(rows);
    const months = monthsBetween(input.fromPeriod, input.toPeriod);
    const { totals } = buildMonthTable(rows, months);
    const { kpis } = computeKpis(
      rows,
      filterByCostCenter(
        previousRes.data,
        input.costCenterId ?? ALL_COST_CENTERS,
      ),
      months,
      input.toPeriod,
    );
    const byCostCenter = costCenterBreakdown(res.data).map((c) => ({
      costCenterId: c.costCenterId,
      costCenter:
        c.costCenterId === null
          ? "Sin centro"
          : (names.get(c.costCenterId) ?? "Centro eliminado"),
      serviceRevenue: c.waterfall.serviceRevenue,
      operatingCost: c.waterfall.operatingCost,
      operatingMargin: c.waterfall.operatingMargin,
      fleetInvestment: c.waterfall.fleetInvestment,
    }));
    const scopeLabel = input.costCenterId
      ? ` · centro ${
          input.costCenterId === NO_COST_CENTER
            ? "Sin centro"
            : (names.get(input.costCenterId) ?? input.costCenterId)
        }`
      : "";
    return okResult(
      `Gestión ${input.fromPeriod}→${input.toPeriod}${scopeLabel} (uso interno): servicios ${money(
        waterfall.serviceRevenue,
      )} · costos operativos ${money(waterfall.operatingCost)} · margen operativo ${money(
        waterfall.operatingMargin,
      )} · generación de caja ${money(waterfall.cashGeneration)}.` +
        (waterfall.pendingUsd !== 0
          ? ` Hay USD sin cotización (US$${waterfall.pendingUsd}) no sumados.`
          : ""),
      { basis: input.basis, waterfall, totals, byCostCenter, kpis },
      { currency: "ARS", note: INTERNAL_NOTE },
    );
  },
});

const ManagementDocumentsToolInputSchema = z
  .object({
    fromPeriod: PeriodSchema.describe("Período desde, YYYY-MM."),
    toPeriod: PeriodSchema.describe("Período hasta, YYYY-MM (inclusive)."),
    basis: z
      .enum(MANAGEMENT_BASES)
      .default("accrual")
      .describe("'accrual' (devengado) o 'cash' (percibido)."),
    line: z
      .string()
      .refine((k) => MANAGEMENT_LINE_KEYS.includes(k), "Línea desconocida.")
      .describe(
        `Línea de la tabla de gestión: ${MANAGEMENT_LINE_KEYS.join(", ")} (op:<subrubro> son los costos operativos por subrubro).`,
      ),
    side: z
      .enum(SIDE_VIEWS)
      .default("total")
      .describe("'total' (fiscal + interno), 'fiscal' o 'internal'."),
    costCenterId: z
      .union([z.string().uuid(), z.literal(NO_COST_CENTER)])
      .nullish()
      .describe(
        "Opcional: UUID de un centro de costo, o 'none' para lo cargado sin centro. Sin valor: todos.",
      ),
  })
  .refine((v) => v.fromPeriod <= v.toPeriod, "Rango de períodos invertido.");

/** The most documents the tool hands the model (the largest first). */
const TOOL_DOCUMENTS = 40;

export const getManagementPnLDocuments = defineAiAction({
  name: "getManagementPnLDocuments",
  domain: "contabilidad",
  permission: "management:read",
  sideEffect: "read",
  sources: [
    "get_management_pnl_documents",
    "journal_entry_lines",
    "journal_document_entry",
    "transactions",
  ],
  description:
    "Detalle de una cifra del resultado de gestión (uso interno): qué comprobantes y movimientos (ventas, compras, recibos, órdenes de pago, sueldos, préstamos, cuenta del empleado, cheques, movimientos de tesorería, asientos manuales) forman una línea en un rango de meses, de mayor a menor importe, con fecha, contraparte y link. Importes nominales (sin ajuste por inflación). Usar después de getManagementPnL para explicar por qué una línea da lo que da. Uso interno: nunca para terceros.",
  input: ManagementDocumentsToolInputSchema,
  run: async (_ctx, input): Promise<AiRunResult> => {
    const res = await getManagementDrillAction({
      fromPeriod: input.fromPeriod,
      toPeriod: input.toPeriod,
      basis: input.basis,
      lineKey: input.line,
      side: input.side,
      costCenter: input.costCenterId ?? ALL_COST_CENTERS,
    });
    if (!res.ok) return errResult(res.error);
    const shown = res.data.documents.slice(0, TOOL_DOCUMENTS);
    const label =
      TABLE_LINES.find((l) => l.key === input.line)?.label ?? input.line;
    const cut =
      shown.length < res.data.count
        ? ` (se muestran los ${shown.length} mayores)`
        : "";
    return okResult(
      `Gestión ${input.fromPeriod}→${input.toPeriod} · ${label} (uso interno): ${res.data.count} documentos, total ${money(res.data.total)}${cut}.`,
      {
        count: res.data.count,
        total: res.data.total,
        pendingUsd: res.data.pendingUsd,
        documents: shown.map((d) => ({
          type: DOC_TYPE_LABEL[d.docType],
          document: d.label,
          date: d.docDate,
          month: d.month,
          counterparty: d.counterparty,
          side: d.side,
          amount: d.amount,
          pendingUsd: d.pendingUsd,
          href: d.href,
        })),
      },
      {
        currency: "ARS",
        note: INTERNAL_NOTE,
        partial: res.data.partial || shown.length < res.data.count,
      },
    );
  },
});
