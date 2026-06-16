import { tool } from "ai";
import { z } from "zod";

import { getAccountBalancesAction } from "@/features/balance/actions/balance-actions";
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
