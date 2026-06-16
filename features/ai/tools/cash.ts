import { tool } from "ai";
import { z } from "zod";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { listChecksAction } from "@/features/checks/actions/checks-actions";
import { listIssuedChecksAction } from "@/features/issued-checks/actions/issued-checks-actions";
import { listTransactionsAction } from "@/features/transactions/actions/transactions-actions";

import { type AiToolResult, errResult, money, okResult } from "./result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`accounts:read` / `transactions:read` / `cheques:read` /
// `issued_checks:read`) + RLS, so the tool adds no new data access.

export async function runAccounts(): Promise<AiToolResult> {
  const res = await listAccountsAction();
  if (!res.ok) return errResult(res.error);
  const active = res.data.filter((a) => a.is_active).length;
  return okResult(
    `${res.data.length} cuentas (${active} activas). Para saldos actuales usá getTreasurySummary.`,
    res.data,
  );
}

export const getAccounts = tool({
  description:
    "Cuentas de tesorería (banco/caja/billetera/cheques) con moneda y saldo " +
    "inicial. Sin parámetros. Para saldos ACTUALES usá getTreasurySummary; esta " +
    "lista sirve para conocer las cuentas y sus UUID.",
  inputSchema: z.object({}),
  execute: () => runAccounts(),
});

export async function runTransactions(input: {
  accountId?: string | null;
  channelId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await listTransactionsAction({
    account_id: input.accountId ?? null,
    channel_id: input.channelId ?? null,
    date_from: input.dateFrom ?? null,
    date_to: input.dateTo ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.items.length} movimientos de caja${
      res.data.nextOffset !== null ? " (hay más, acotá por fecha/cuenta)" : ""
    }.`,
    res.data,
  );
}

export const getTransactions = tool({
  description:
    "Movimientos de caja/tesorería (ingresos, egresos, transferencias) con " +
    "cuenta, canal, fecha, importe y contraparte. Filtrable por cuenta, canal y " +
    "rango de fechas (YYYY-MM-DD). Para ver flujo de caja o un movimiento puntual.",
  inputSchema: z.object({
    accountId: z.string().nullish().describe("UUID de la cuenta, opcional."),
    channelId: z.string().nullish().describe("UUID del canal, opcional."),
    dateFrom: z.string().nullish().describe("Fecha desde YYYY-MM-DD."),
    dateTo: z.string().nullish().describe("Fecha hasta YYYY-MM-DD."),
    limit: z.number().nullish().describe("Máximo de filas (default 25, máx 200)."),
  }),
  execute: (input) => runTransactions(input),
});

export async function runChecks(): Promise<AiToolResult> {
  const res = await listChecksAction();
  if (!res.ok) return errResult(res.error);
  const total = res.data.items.reduce((s, c) => s + Number(c.amount), 0);
  const enCartera = res.data.items.filter(
    (c) => c.status === "en_cartera",
  ).length;
  return okResult(
    `${res.data.items.length} cheques recibidos (${enCartera} en cartera) · ` +
      `total ${money(total)}.`,
    res.data,
  );
}

export const getChecks = tool({
  description:
    "Cheques de terceros recibidos: número, banco, librador, vencimiento, " +
    "importe, moneda y estado (en cartera / depositado / acreditado / endosado / " +
    "rechazado). Sin parámetros. Para cartera de cheques o cobros con cheque.",
  inputSchema: z.object({}),
  execute: () => runChecks(),
});

export async function runIssuedChecks(): Promise<AiToolResult> {
  const res = await listIssuedChecksAction();
  if (!res.ok) return errResult(res.error);
  const total = res.data.reduce((s, c) => s + c.amount, 0);
  return okResult(
    `${res.data.length} cheques propios emitidos · total ${money(total)}.`,
    res.data,
  );
}

export const getIssuedChecks = tool({
  description:
    "Cheques propios emitidos a proveedores: número, banco, beneficiario, " +
    "vencimiento, importe, moneda y estado (emitido / cobrado / rechazado / " +
    "anulado). Sin parámetros. Para pagos con cheque propio o cheques a vencer.",
  inputSchema: z.object({}),
  execute: () => runIssuedChecks(),
});
