import { tool } from "ai";
import { z } from "zod";

import { getAccountBalancesAction } from "@/features/balance/actions/balance-actions";
import { listChartOfAccountsAction } from "@/features/chart-of-accounts/actions/chart-of-accounts-actions";
import { listCostCentersAction } from "@/features/cost-centers/actions/cost-centers-actions";
import { listInflationAdjustmentsAction } from "@/features/inflation/actions/inflation-actions";
import { listJournalEntriesAction } from "@/features/journal-entries/actions/journal-entries-actions";
import { getLedgerAction } from "@/features/libro-mayor/actions/libro-mayor-actions";
import {
  listLibroIvaComprasAction,
  listLibroIvaVentasAction,
} from "@/features/libro-iva/actions/libro-iva-actions";

import { type AiToolResult, errResult, money, okResult } from "./result";

// Tool inputs stay loose (plain strings); the underlying actions re-validate
// strictly with their own Zod schemas (period regex, UUID, ISO date).

export async function runTrialBalance(input: {
  periodEnd: string;
  periodStart?: string | null;
}): Promise<AiToolResult> {
  const res = await getAccountBalancesAction({
    periodEnd: input.periodEnd,
    periodStart: input.periodStart ?? null,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} cuentas con movimiento acumulado hasta ${input.periodEnd}.`,
    res.data,
  );
}

export const getTrialBalance = tool({
  description:
    "Balance de saldos (sumas y saldos): por cuenta contable, debe/haber/saldo " +
    "acumulado hasta un período YYYY-MM. Base del Estado de Resultados y Balance " +
    "General. Solo refleja canales fiscales (caja contable).",
  inputSchema: z.object({
    periodEnd: z.string().describe("Período de corte YYYY-MM, ej. '2026-05'."),
    periodStart: z
      .string()
      .nullish()
      .describe("Período inicial YYYY-MM opcional para acotar el rango."),
  }),
  execute: (input) => runTrialBalance(input),
});

export async function runLedger(input: {
  accountId: string;
  from?: string | null;
  to?: string | null;
}): Promise<AiToolResult> {
  const res = await getLedgerAction({
    accountId: input.accountId,
    from: input.from ?? null,
    to: input.to ?? null,
  });
  if (!res.ok) return errResult(res.error);
  const last = res.data.rows.at(-1);
  const saldo = last ? Number(last.running) : 0;
  return okResult(
    `${res.data.rows.length} movimientos${
      res.data.truncated ? " (truncado a 1000 — acotá por fecha)" : ""
    } · saldo final ${money(saldo)}.`,
    res.data,
  );
}

export const getLedger = tool({
  description:
    "Libro mayor de UNA cuenta contable: movimientos con saldo corriente entre " +
    "fechas. Requiere el UUID de la cuenta (obtenible del plan de cuentas / " +
    "getTrialBalance).",
  inputSchema: z.object({
    accountId: z.string().describe("UUID de la cuenta del plan de cuentas."),
    from: z.string().nullish().describe("Fecha desde YYYY-MM-DD, opcional."),
    to: z.string().nullish().describe("Fecha hasta YYYY-MM-DD, opcional."),
  }),
  execute: (input) => runLedger(input),
});

export async function runLibroIvaVentas(input: {
  period: string;
  channelId?: string | null;
}): Promise<AiToolResult> {
  const res = await listLibroIvaVentasAction({
    period: input.period,
    channelId: input.channelId ?? null,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} filas de IVA Ventas para ${input.period} (una por comprobante × alícuota).`,
    res.data,
  );
}

export const getLibroIvaVentas = tool({
  description:
    "Libro IVA Ventas (RG 1361) de un período YYYY-MM: una fila por comprobante " +
    "× alícuota (neto/IVA por tasa), solo canales fiscales. IVA débito del período.",
  inputSchema: z.object({
    period: z.string().describe("Período YYYY-MM, ej. '2026-05'."),
    channelId: z
      .string()
      .nullish()
      .describe("Canal fiscal opcional para filtrar."),
  }),
  execute: (input) => runLibroIvaVentas(input),
});

export async function runLibroIvaCompras(input: {
  period: string;
  channelId?: string | null;
}): Promise<AiToolResult> {
  const res = await listLibroIvaComprasAction({
    period: input.period,
    channelId: input.channelId ?? null,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} filas de IVA Compras para ${input.period} (una por comprobante × alícuota).`,
    res.data,
  );
}

export const getLibroIvaCompras = tool({
  description:
    "Libro IVA Compras (RG 1361) de un período YYYY-MM: una fila por factura de " +
    "compra × alícuota, solo canales fiscales. IVA crédito del período.",
  inputSchema: z.object({
    period: z.string().describe("Período YYYY-MM, ej. '2026-05'."),
    channelId: z
      .string()
      .nullish()
      .describe("Canal fiscal opcional para filtrar."),
  }),
  execute: (input) => runLibroIvaCompras(input),
});

export async function runChartOfAccounts(input: {
  onlyActive?: boolean | null;
}): Promise<AiToolResult> {
  const res = await listChartOfAccountsAction({
    onlyActive: input.onlyActive ?? true,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(`${res.data.length} cuentas en el plan de cuentas.`, res.data);
}

export const getChartOfAccounts = tool({
  description:
    "Plan de cuentas contable: código, nombre, tipo (activo/pasivo/patrimonio/" +
    "resultado) y rol de sistema de cada cuenta. Útil para encontrar el UUID de " +
    "una cuenta (p. ej. para getLedger) o entender la estructura contable.",
  inputSchema: z.object({
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Solo cuentas activas (default true)."),
  }),
  execute: (input) => runChartOfAccounts(input),
});

export async function runJournalEntries(input: {
  period?: string | null;
  channelId?: string | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await listJournalEntriesAction({
    period: input.period ?? null,
    channelId: input.channelId ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.items.length} asientos${
      input.period ? ` de ${input.period}` : ""
    }${res.data.nextOffset !== null ? " (hay más, acotá por período)" : ""}.`,
    res.data,
  );
}

export const getJournalEntries = tool({
  description:
    "Libro diario: asientos contables con fecha, período de devengamiento, " +
    "descripción y sus líneas (debe/haber por cuenta). Filtrable por período " +
    "YYYY-MM y canal. Solo canales fiscales (caja contable).",
  inputSchema: z.object({
    period: z.string().nullish().describe("Período YYYY-MM, opcional."),
    channelId: z.string().nullish().describe("UUID del canal, opcional."),
    limit: z.number().nullish().describe("Máximo de asientos (default 25)."),
  }),
  execute: (input) => runJournalEntries(input),
});

export async function runCostCenters(input: {
  onlyActive?: boolean | null;
}): Promise<AiToolResult> {
  const res = await listCostCentersAction({
    onlyActive: input.onlyActive ?? true,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(`${res.data.length} centros de costo.`, res.data);
}

export const getCostCenters = tool({
  description:
    "Centros de costo (dimensiones contables): código, nombre y estado. Sin " +
    "parámetros obligatorios. Para analizar gastos/resultados por dimensión.",
  inputSchema: z.object({
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Solo activos (default true)."),
  }),
  execute: (input) => runCostCenters(input),
});

export async function runInflationAdjustments(): Promise<AiToolResult> {
  const res = await listInflationAdjustmentsAction();
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} ajustes por inflación (RG 4667) registrados.`,
    res.data,
  );
}

export const getInflationAdjustments = tool({
  description:
    "Ajustes por inflación (RG 4667): período, coeficiente aplicado y si ya se " +
    "asentó. Sin parámetros. Para el ajuste contable por inflación.",
  inputSchema: z.object({}),
  execute: () => runInflationAdjustments(),
});
