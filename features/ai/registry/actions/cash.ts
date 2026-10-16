import { z } from "zod";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { listChecksAction } from "@/features/checks/actions/checks-actions";
import { listIssuedChecksAction } from "@/features/issued-checks/actions/issued-checks-actions";
import { listRecurringPaymentsAction } from "@/features/recurring-payments/actions/recurring-payments-actions";
import { listTransactionsAction } from "@/features/transactions/actions/transactions-actions";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, money, okResult } from "../result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`accounts:read` / `transactions:read` / `cheques:read` /
// `issued_checks:read`) + RLS, so the tool adds no new data access.

export async function runAccounts(): Promise<AiRunResult> {
  const res = await listAccountsAction();
  if (!res.ok) return errResult(res.error);
  const active = res.data.filter((a) => a.is_active).length;
  return okResult(
    `${res.data.length} accounts (${active} active). For current balances use getTreasurySummary.`,
    res.data,
  );
}

export const getAccounts = defineAiAction({
  name: "getAccounts",
  domain: "tesoreria",
  permission: "accounts:read",
  sideEffect: "read",
  sources: ["accounts"],
  description:
    "Treasury accounts (bank/cash/wallet/checks) with currency and opening " +
    "balance. No parameters. For CURRENT balances use getTreasurySummary; this " +
    "list is for knowing the accounts and their UUIDs.",
  input: z.object({}),
  run: () => runAccounts(),
});

export async function runTransactions(input: {
  accountId?: string | null;
  channelId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number | null;
}): Promise<AiRunResult> {
  const res = await listTransactionsAction({
    account_id: input.accountId ?? null,
    channel_id: input.channelId ?? null,
    date_from: input.dateFrom ?? null,
    date_to: input.dateTo ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.items.length} cash movements${
      res.data.nextOffset !== null
        ? " (more available, narrow by date/account)"
        : ""
    }.`,
    res.data,
    { partial: res.data.nextOffset !== null },
  );
}

export const getTransactions = defineAiAction({
  name: "getTransactions",
  domain: "tesoreria",
  permission: "transactions:read",
  sideEffect: "read",
  sources: ["v_transactions_tagged"],
  description:
    "Cash/treasury movements (inflows, outflows, transfers) with account, " +
    "channel, date, amount and counterparty. Filterable by account, channel and " +
    "date range (YYYY-MM-DD). For viewing cash flow or a specific movement.",
  input: z.object({
    accountId: z.string().nullish().describe("Account UUID, optional."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    dateFrom: z.string().nullish().describe("Date from YYYY-MM-DD."),
    dateTo: z.string().nullish().describe("Date to YYYY-MM-DD."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  run: (_ctx, input) => runTransactions(input),
});

export async function runChecks(): Promise<AiRunResult> {
  const res = await listChecksAction();
  if (!res.ok) return errResult(res.error);
  const total = res.data.items.reduce((s, c) => s + Number(c.amount), 0);
  const enCartera = res.data.items.filter(
    (c) => c.status === "en_cartera",
  ).length;
  return okResult(
    `${res.data.items.length} checks received (${enCartera} in portfolio) · ` +
      `total ${money(total)}.`,
    res.data,
  );
}

export const getChecks = defineAiAction({
  name: "getChecks",
  domain: "tesoreria",
  permission: "cheques:read",
  sideEffect: "read",
  sources: ["checks"],
  description:
    "Third-party checks received: number, bank, drawer, due date, amount, " +
    "currency and status (in portfolio / deposited / credited / endorsed / " +
    "bounced). No parameters. For the check portfolio or collections by check.",
  input: z.object({}),
  run: () => runChecks(),
});

export async function runIssuedChecks(): Promise<AiRunResult> {
  const res = await listIssuedChecksAction();
  if (!res.ok) return errResult(res.error);
  const total = res.data.reduce((s, c) => s + c.amount, 0);
  return okResult(
    `${res.data.length} own checks issued · total ${money(total)}.`,
    res.data,
  );
}

export const getIssuedChecks = defineAiAction({
  name: "getIssuedChecks",
  domain: "tesoreria",
  permission: "issued_checks:read",
  sideEffect: "read",
  sources: ["issued_checks"],
  description:
    "Own checks issued to suppliers: number, bank, payee, due date, amount, " +
    "currency and status (issued / cashed / bounced / voided). No parameters. " +
    "For payments by own check or upcoming check due dates.",
  input: z.object({}),
  run: () => runIssuedChecks(),
});

export const getRecurringPayments = defineAiAction({
  name: "getRecurringPayments",
  domain: "tesoreria",
  permission: "recurring_payments:read",
  sideEffect: "read",
  sources: ["recurring_payments"],
  description:
    "Pagos recurrentes (alquileres, servicios, impuestos, sueldos fijos, etc.): descripción, categoría, monto, moneda, frecuencia, próximo vencimiento y estado.",
  input: z.object({
    onlyActive: z.boolean().nullish().describe("Solo activos (default true)."),
  }),
  run: async (_ctx, input) => {
    const res = await listRecurringPaymentsAction({
      onlyActive: input.onlyActive ?? true,
    });
    if (!res.ok) return errResult(res.error);
    const soonest = res.data.find((r) => r.is_active);
    return okResult(
      `${res.data.length} pagos recurrentes` +
        (soonest
          ? ` · próximo: ${soonest.description} el ${soonest.next_due_date} (${soonest.currency} ${money(
              soonest.amount,
            )}).`
          : "."),
      res.data,
    );
  },
});
