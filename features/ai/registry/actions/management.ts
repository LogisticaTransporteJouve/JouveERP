import { z } from "zod";

import { getManagementPnlAction } from "@/features/management/actions/management-actions";
import {
  MANAGEMENT_BASES,
  buildMonthTable,
  computeWaterfall,
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
  ],
  description:
    "Resultado de gestión (uso interno): ¿la operación deja plata? Suma lo fiscal y lo interno en una cascada (servicios, costos operativos con sueldos y sueldos internos (extras) aparte, margen operativo, costo financiero, capital de préstamos, inversión en flota, venta de bienes de uso, generación de caja) y la tabla por mes. Gestión = uso interno; para bancos/ARCA usar el EERR fiscal (getIncomeStatement) o el balance (getBalanceSheet). Nunca ofrecer estos datos para presentar a terceros.",
  input: ManagementPnlToolInputSchema,
  run: async (_ctx, input): Promise<AiRunResult> => {
    const res = await getManagementPnlAction({
      fromPeriod: input.fromPeriod,
      toPeriod: input.toPeriod,
      basis: input.basis,
      inflation: false,
    });
    if (!res.ok) return errResult(res.error);
    const waterfall = computeWaterfall(res.data);
    const months = monthsBetween(input.fromPeriod, input.toPeriod);
    const { totals } = buildMonthTable(res.data, months);
    return okResult(
      `Gestión ${input.fromPeriod}→${input.toPeriod} (uso interno): servicios ${money(
        waterfall.serviceRevenue,
      )} · costos operativos ${money(waterfall.operatingCost)} · margen operativo ${money(
        waterfall.operatingMargin,
      )} · generación de caja ${money(waterfall.cashGeneration)}.` +
        (waterfall.pendingUsd !== 0
          ? ` Hay USD sin cotización (US$${waterfall.pendingUsd}) no sumados.`
          : ""),
      { basis: input.basis, waterfall, totals },
      { currency: "ARS", note: INTERNAL_NOTE },
    );
  },
});
