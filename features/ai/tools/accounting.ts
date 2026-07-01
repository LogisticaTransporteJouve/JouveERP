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
    `${res.data.length} accounts with accumulated movement up to ${input.periodEnd}.`,
    res.data,
  );
}

export const getTrialBalance = tool({
  description:
    "Trial balance (sums and balances): per ledger account, debit/credit/" +
    "accumulated balance up to a YYYY-MM period. Basis of the Income Statement " +
    "and Balance Sheet. Only reflects fiscal channels (accounting books).",
  inputSchema: z.object({
    periodEnd: z.string().describe("Cutoff period YYYY-MM, e.g. '2026-05'."),
    periodStart: z
      .string()
      .nullish()
      .describe("Optional start period YYYY-MM to narrow the range."),
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
  const balance = last ? Number(last.running) : 0;
  return okResult(
    `${res.data.rows.length} movements${
      res.data.truncated ? " (truncated to 1000 — narrow by date)" : ""
    } · closing balance ${money(balance)}.`,
    res.data,
  );
}

export const getLedger = tool({
  description:
    "General ledger of ONE ledger account: movements with running balance " +
    "between dates. Requires the account UUID (obtainable from the chart of " +
    "accounts / getTrialBalance).",
  inputSchema: z.object({
    accountId: z.string().describe("UUID of the chart of accounts account."),
    from: z.string().nullish().describe("Date from YYYY-MM-DD, optional."),
    to: z.string().nullish().describe("Date to YYYY-MM-DD, optional."),
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
    `${res.data.length} VAT Sales rows for ${input.period} (one per document × rate).`,
    res.data,
  );
}

export const getLibroIvaVentas = tool({
  description:
    "VAT Sales book (RG 1361) for a YYYY-MM period: one row per document × rate " +
    "(net/VAT per rate), fiscal channels only. Output VAT for the period.",
  inputSchema: z.object({
    period: z.string().describe("Period YYYY-MM, e.g. '2026-05'."),
    channelId: z
      .string()
      .nullish()
      .describe("Optional fiscal channel to filter."),
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
    `${res.data.length} VAT Purchases rows for ${input.period} (one per document × rate).`,
    res.data,
  );
}

export const getLibroIvaCompras = tool({
  description:
    "VAT Purchases book (RG 1361) for a YYYY-MM period: one row per purchase " +
    "invoice × rate, fiscal channels only. Input VAT for the period.",
  inputSchema: z.object({
    period: z.string().describe("Period YYYY-MM, e.g. '2026-05'."),
    channelId: z
      .string()
      .nullish()
      .describe("Optional fiscal channel to filter."),
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
  return okResult(`${res.data.length} accounts in the chart of accounts.`, res.data);
}

export const getChartOfAccounts = tool({
  description:
    "Chart of accounts: code, name, type (asset/liability/equity/result) and " +
    "system role of each account. Useful to find an account's UUID (e.g. for " +
    "getLedger) or to understand the accounting structure.",
  inputSchema: z.object({
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Active accounts only (default true)."),
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
    `${res.data.items.length} journal entries${
      input.period ? ` for ${input.period}` : ""
    }${res.data.nextOffset !== null ? " (more available, narrow by period)" : ""}.`,
    res.data,
  );
}

export const getJournalEntries = tool({
  description:
    "General journal: journal entries with date, accrual period, description " +
    "and their lines (debit/credit per account). Filterable by period YYYY-MM " +
    "and channel. Fiscal channels only (accounting books).",
  inputSchema: z.object({
    period: z.string().nullish().describe("Period YYYY-MM, optional."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    limit: z.number().nullish().describe("Max entries (default 25)."),
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
  return okResult(`${res.data.length} cost centers.`, res.data);
}

export const getCostCenters = tool({
  description:
    "Cost centers (accounting dimensions): code, name and status. No required " +
    "parameters. For analyzing expenses/results by dimension.",
  inputSchema: z.object({
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Active only (default true)."),
  }),
  execute: (input) => runCostCenters(input),
});

export async function runInflationAdjustments(): Promise<AiToolResult> {
  const res = await listInflationAdjustmentsAction();
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.length} inflation adjustments (RG 4667) recorded.`,
    res.data,
  );
}

export const getInflationAdjustments = tool({
  description:
    "Inflation adjustments (RG 4667): period, applied coefficient and whether " +
    "it was already posted. No parameters. For the accounting inflation adjustment.",
  inputSchema: z.object({}),
  execute: () => runInflationAdjustments(),
});
