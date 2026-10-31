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

import { SCOPE_LABEL, type FiscalFilter } from "@/lib/scope";
import { ScopeInputSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import {
  type AiRunResult,
  errResult,
  money,
  okResult,
  reachedCap,
} from "../result";
import { readScope } from "../scope";

// Tool inputs stay loose (plain strings); the underlying actions re-validate
// strictly with their own Zod schemas (period regex, UUID, ISO date).

export async function runTrialBalance(input: {
  periodEnd: string;
  periodStart?: string | null;
}): Promise<AiRunResult> {
  const res = await getAccountBalancesAction({
    periodEnd: input.periodEnd,
    periodStart: input.periodStart ?? null,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} accounts with accumulated movement up to ${input.periodEnd}.`,
    res.data,
    { partial: reachedCap(res.data.length) },
  );
}

export const getTrialBalance = defineAiAction({
  name: "getTrialBalance",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["get_account_balances"],
  description:
    "Trial balance (sums and balances): per ledger account, debit/credit/" +
    "accumulated balance up to a YYYY-MM period. Basis of the Income Statement " +
    "and Balance Sheet. Only reflects fiscal channels (accounting books).",
  input: z.object({
    periodEnd: z.string().describe("Cutoff period YYYY-MM, e.g. '2026-05'."),
    periodStart: z
      .string()
      .nullish()
      .describe("Optional start period YYYY-MM to narrow the range."),
  }),
  run: (_ctx, input) => runTrialBalance(input),
});

export async function runLedger(input: {
  accountId: string;
  from?: string | null;
  to?: string | null;
}): Promise<AiRunResult> {
  const res = await getLedgerAction({
    accountId: input.accountId,
    from: input.from ?? null,
    to: input.to ?? null,
  });
  if (!res.ok) return errResult(res.error);
  const last = res.data.rows.at(-1);
  const balance = last ? Number(last.running) : 0;
  return okResult(
    `${res.data.rows.length} movements${
      res.data.truncated ? " (truncated to 1000 — narrow by date)" : ""
    } · closing balance ${money(balance)}.`,
    res.data,
    { partial: res.data.truncated },
  );
}

export const getLedger = defineAiAction({
  name: "getLedger",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["get_ledger"],
  description:
    "General ledger of ONE ledger account: movements with running balance " +
    "between dates. Requires the account UUID (obtainable from the chart of " +
    "accounts / getTrialBalance).",
  input: z.object({
    accountId: z.string().describe("UUID of the chart of accounts account."),
    from: z.string().nullish().describe("Date from YYYY-MM-DD, optional."),
    to: z.string().nullish().describe("Date to YYYY-MM-DD, optional."),
  }),
  run: (_ctx, input) => runLedger(input),
});

const LIBRO_IVA_CURRENCY_NOTE =
  "neto/iva/imp_* are pesos (amount × the document's cotizacion); *_orig are in the document's moneda.";

export async function runLibroIvaVentas(input: {
  period: string;
}): Promise<AiRunResult> {
  const res = await listLibroIvaVentasAction({ period: input.period });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${SCOPE_LABEL.fiscal}: ${res.data.length} VAT Sales rows for ${input.period} (one per document × rate).`,
    res.data,
    { currency: "ARS", note: LIBRO_IVA_CURRENCY_NOTE },
  );
}

export const getLibroIvaVentas = defineAiAction({
  name: "getLibroIvaVentas",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["libro_iva_ventas"],
  description:
    "VAT Sales book (RG 1361) for a YYYY-MM period: one row per document × rate " +
    "(net/VAT per rate), fiscal channels only. Output VAT for the period. " +
    "Amounts in ARS at each document's own exchange rate; *_orig, moneda and " +
    "cotizacion keep the original currency.",
  input: z.object({
    period: z.string().describe("Period YYYY-MM, e.g. '2026-05'."),
  }),
  run: (_ctx, input) => runLibroIvaVentas(input),
});

export async function runLibroIvaCompras(input: {
  period: string;
}): Promise<AiRunResult> {
  const res = await listLibroIvaComprasAction({ period: input.period });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${SCOPE_LABEL.fiscal}: ${res.data.length} VAT Purchases rows for ${input.period} (one per document × rate).`,
    res.data,
    { currency: "ARS", note: LIBRO_IVA_CURRENCY_NOTE },
  );
}

export const getLibroIvaCompras = defineAiAction({
  name: "getLibroIvaCompras",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["libro_iva_compras"],
  description:
    "VAT Purchases book (RG 1361) for a YYYY-MM period: one row per purchase " +
    "invoice × rate, fiscal channels only. Input VAT for the period. " +
    "Amounts in ARS at each document's own exchange rate; *_orig, moneda and " +
    "cotizacion keep the original currency.",
  input: z.object({
    period: z.string().describe("Period YYYY-MM, e.g. '2026-05'."),
  }),
  run: (_ctx, input) => runLibroIvaCompras(input),
});

export async function runChartOfAccounts(input: {
  onlyActive?: boolean | null;
}): Promise<AiRunResult> {
  const res = await listChartOfAccountsAction({
    onlyActive: input.onlyActive ?? true,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} accounts in the chart of accounts.`,
    res.data,
  );
}

export const getChartOfAccounts = defineAiAction({
  name: "getChartOfAccounts",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["chart_of_accounts"],
  description:
    "Chart of accounts: code, name, type (asset/liability/equity/result) and " +
    "system role of each account. Useful to find an account's UUID (e.g. for " +
    "getLedger) or to understand the accounting structure.",
  input: z.object({
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Active accounts only (default true)."),
  }),
  run: (_ctx, input) => runChartOfAccounts(input),
});

export async function runJournalEntries(input: {
  period?: string | null;
  scope?: FiscalFilter | null;
  limit?: number | null;
}): Promise<AiRunResult> {
  const { isFiscal, label } = readScope(input.scope);
  const res = await listJournalEntriesAction({
    period: input.period ?? null,
    isFiscal,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${label}: ${res.data.items.length} journal entries${
      input.period ? ` for ${input.period}` : ""
    }${res.data.nextOffset !== null ? " (more available, narrow by period)" : ""}.`,
    res.data,
    { partial: res.data.nextOffset !== null },
  );
}

export const getJournalEntries = defineAiAction({
  name: "getJournalEntries",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["journal_entries", "journal_entry_lines"],
  description:
    "General journal: journal entries with date, accrual period, description " +
    "and their lines (debit/credit per account). Filterable by period YYYY-MM " +
    "and scope. The books hold fiscal channels only; entries without a " +
    "channel (general fiscal) only appear with scope 'all'.",
  input: z.object({
    period: z.string().nullish().describe("Period YYYY-MM, optional."),
    scope: ScopeInputSchema,
    limit: z.number().nullish().describe("Max entries (default 25)."),
  }),
  run: (_ctx, input) => runJournalEntries(input),
});

export async function runCostCenters(input: {
  onlyActive?: boolean | null;
}): Promise<AiRunResult> {
  const res = await listCostCentersAction({
    onlyActive: input.onlyActive ?? true,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(`${res.data.length} cost centers.`, res.data);
}

export const getCostCenters = defineAiAction({
  name: "getCostCenters",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["cost_centers"],
  description:
    "Cost centers (accounting dimensions): code, name and status. No required " +
    "parameters. For analyzing expenses/results by dimension.",
  input: z.object({
    onlyActive: z.boolean().nullish().describe("Active only (default true)."),
  }),
  run: (_ctx, input) => runCostCenters(input),
});

export async function runInflationAdjustments(): Promise<AiRunResult> {
  const res = await listInflationAdjustmentsAction();
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} inflation adjustments (RG 4667) recorded.`,
    res.data,
  );
}

export const getInflationAdjustments = defineAiAction({
  name: "getInflationAdjustments",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["inflation_adjustments"],
  description:
    "Inflation adjustments (RG 4667): period, applied coefficient and whether " +
    "it was already posted. No parameters. For the accounting inflation adjustment.",
  input: z.object({}),
  run: () => runInflationAdjustments(),
});
