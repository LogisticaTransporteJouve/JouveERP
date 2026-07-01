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
    `${res.data.length} accounts (${active} active). For current balances use getTreasurySummary.`,
    res.data,
  );
}

export const getAccounts = tool({
  description:
    "Treasury accounts (bank/cash/wallet/checks) with currency and opening " +
    "balance. No parameters. For CURRENT balances use getTreasurySummary; this " +
    "list is for knowing the accounts and their UUIDs.",
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
    `${res.data.items.length} cash movements${
      res.data.nextOffset !== null ? " (more available, narrow by date/account)" : ""
    }.`,
    res.data,
  );
}

export const getTransactions = tool({
  description:
    "Cash/treasury movements (inflows, outflows, transfers) with account, " +
    "channel, date, amount and counterparty. Filterable by account, channel and " +
    "date range (YYYY-MM-DD). For viewing cash flow or a specific movement.",
  inputSchema: z.object({
    accountId: z.string().nullish().describe("Account UUID, optional."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    dateFrom: z.string().nullish().describe("Date from YYYY-MM-DD."),
    dateTo: z.string().nullish().describe("Date to YYYY-MM-DD."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
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
    `${res.data.items.length} checks received (${enCartera} in portfolio) · ` +
      `total ${money(total)}.`,
    res.data,
  );
}

export const getChecks = tool({
  description:
    "Third-party checks received: number, bank, drawer, due date, amount, " +
    "currency and status (in portfolio / deposited / credited / endorsed / " +
    "bounced). No parameters. For the check portfolio or collections by check.",
  inputSchema: z.object({}),
  execute: () => runChecks(),
});

export async function runIssuedChecks(): Promise<AiToolResult> {
  const res = await listIssuedChecksAction();
  if (!res.ok) return errResult(res.error);
  const total = res.data.reduce((s, c) => s + c.amount, 0);
  return okResult(
    `${res.data.length} own checks issued · total ${money(total)}.`,
    res.data,
  );
}

export const getIssuedChecks = tool({
  description:
    "Own checks issued to suppliers: number, bank, payee, due date, amount, " +
    "currency and status (issued / cashed / bounced / voided). No parameters. " +
    "For payments by own check or upcoming check due dates.",
  inputSchema: z.object({}),
  execute: () => runIssuedChecks(),
});
