import { z } from "zod";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { listChecksAction } from "@/features/checks/actions/checks-actions";
import { OPEN_CHECK_STATUSES } from "@/features/checks/schema";
import { listIssuedChecksAction } from "@/features/issued-checks/actions/issued-checks-actions";
import { listTransactionsAction } from "@/features/transactions/actions/transactions-actions";

import type { FiscalFilter } from "@/lib/scope";
import { SETTLED_LIST_CAP } from "@/lib/supabase/open-and-recent";
import { ScopeInputSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import {
  type AiRunResult,
  errResult,
  okResult,
  totalsByCurrency,
} from "../result";
import { readScope } from "../scope";

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
  scope?: FiscalFilter | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number | null;
}): Promise<AiRunResult> {
  const { isFiscal, label } = readScope(input.scope);
  const res = await listTransactionsAction({
    account_id: input.accountId ?? null,
    is_fiscal: isFiscal,
    date_from: input.dateFrom ?? null,
    date_to: input.dateTo ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${label}: ${res.data.items.length} cash movements${
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
    "channel, date, amount, counterparty, and for a manual expense its " +
    "expense account (expense_account_id, null = generic 'gastos') and " +
    "cost center (cost_center_id). Filterable by account, scope " +
    "(fiscal/internal/all) and " +
    "date range (YYYY-MM-DD). For viewing cash flow or a specific movement.",
  input: z.object({
    accountId: z.string().nullish().describe("Account UUID, optional."),
    scope: ScopeInputSchema,
    dateFrom: z.string().nullish().describe("Date from YYYY-MM-DD."),
    dateTo: z.string().nullish().describe("Date to YYYY-MM-DD."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  run: (_ctx, input) => runTransactions(input),
});

const CAPPED_NOTE = ` (every open check is listed, but only the latest ${SETTLED_LIST_CAP} settled ones: the count covers only these; the total covers every open check).`;

export async function runChecks(
  input: { scope?: FiscalFilter | null } = {},
): Promise<AiRunResult> {
  const { isFiscal, label } = readScope(input.scope);
  const res = await listChecksAction({ isFiscal });
  if (!res.ok) return errResult(res.error);
  const isOpen = (c: { status: string }) =>
    (OPEN_CHECK_STATUSES as readonly string[]).includes(c.status);
  const total = totalsByCurrency(
    res.data.items.map((c) => ({
      amount: Number(c.amount),
      currency: c.currency,
      counts: isOpen(c),
    })),
  );
  const open = res.data.items.filter(isOpen).length;
  const capped = res.data.truncated;
  return okResult(
    `${label}: ${res.data.items.length} checks received · ${open} in portfolio ` +
      `or deposited, total ${total} (per currency)${capped ? CAPPED_NOTE : "."}`,
    res.data,
    { partial: capped },
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
    "bounced / sold to a bank or financiera). Optional scope (fiscal/internal/all; checks with no channel " +
    "only under 'all'). The total covers only the checks in portfolio or " +
    "deposited. For the check portfolio or collections by check.",
  input: z.object({ scope: ScopeInputSchema }),
  run: (_ctx, input) => runChecks(input),
});

export async function runIssuedChecks(
  input: { scope?: FiscalFilter | null } = {},
): Promise<AiRunResult> {
  const { isFiscal, label } = readScope(input.scope);
  const res = await listIssuedChecksAction({ isFiscal });
  if (!res.ok) return errResult(res.error);
  const total = totalsByCurrency(
    res.data.items.map((c) => ({
      amount: c.amount,
      currency: c.currency,
      counts: c.status === "emitted",
    })),
  );
  const outstanding = res.data.items.filter(
    (c) => c.status === "emitted",
  ).length;
  const capped = res.data.truncated;
  return okResult(
    `${label}: ${res.data.items.length} own checks issued · ${outstanding} not ` +
      `yet cashed, total ${total} (per currency)${capped ? CAPPED_NOTE : "."}`,
    res.data.items,
    { partial: capped },
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
    "currency and status (issued / cashed / bounced / voided). Optional scope " +
    "(fiscal/internal/all). The total covers only the checks not yet cashed. " +
    "For payments by own check or upcoming check due dates.",
  input: z.object({ scope: ScopeInputSchema }),
  run: (_ctx, input) => runIssuedChecks(input),
});
