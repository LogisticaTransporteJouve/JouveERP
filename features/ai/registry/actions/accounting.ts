import { z } from "zod";

import { getAccountBalancesAction } from "@/features/balance/actions/balance-actions";
import { listChartOfAccountsAction } from "@/features/chart-of-accounts/actions/chart-of-accounts-actions";
import { listCostCentersAction } from "@/features/cost-centers/actions/cost-centers-actions";
import { listInflationAdjustmentsAction } from "@/features/inflation/actions/inflation-actions";
import { listJournalEntriesAction } from "@/features/journal-entries/actions/journal-entries-actions";
import { formatInvoiceNumero } from "@/features/invoices/schema";
import { getLedgerAction } from "@/features/libro-mayor/actions/libro-mayor-actions";
import { LEDGER_MAX_ROWS } from "@/features/libro-mayor/lib/libro-mayor-pagination";
import { formatInvoiceNumber } from "@/features/purchase-invoices/schema";
import {
  listLibroIvaComprasAction,
  listLibroIvaVentasAction,
} from "@/features/libro-iva/actions/libro-iva-actions";
import {
  computeComprasTotals,
  computeTotals,
  groupByInvoice,
  groupComprasByInvoice,
  perRateLabel,
  SIN_DISCRIMINAR,
  type PerRate,
} from "@/features/libro-iva/schema";

import { round2 } from "@/lib/format";
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
  const balance = last ? Number(last.running) : res.data.opening;
  const opening = input.from
    ? `opening balance ${money(res.data.opening)} before ${input.from} · `
    : "";
  return okResult(
    `${opening}${res.data.rows.length} movements${
      res.data.truncated
        ? ` (truncated to the first ${LEDGER_MAX_ROWS} — narrow by date; the balance shown is at the last line returned)`
        : ""
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
    "between dates; the running balance starts from `opening` (the balance " +
    "before `from`). Requires the account UUID (obtainable from the chart of " +
    "accounts / getTrialBalance).",
  input: z.object({
    accountId: z.string().describe("UUID of the chart of accounts account."),
    from: z.string().nullish().describe("Date from YYYY-MM-DD, optional."),
    to: z.string().nullish().describe("Date to YYYY-MM-DD, optional."),
  }),
  run: (_ctx, input) => runLedger(input),
});

/** The caption under a chart or table of a libro IVA, for an accountant. */
const LIBRO_IVA_CAPTION =
  "Importes en pesos, a la cotización de cada comprobante. Las notas de crédito figuran en positivo y un comprobante con varias alícuotas aparece una vez por alícuota; los totales del período restan las notas de crédito.";

const LIBRO_IVA_MODEL_NOTE =
  "Rows are document × rate with NCs positive; the period's figures are `totals`, never the sum of the rows. *_orig keep the original currency.";

const LIBRO_IVA_ROWS_RULE =
  "Rows are one per document × rate: an NC (kind 'nc') comes as POSITIVE amounts, " +
  "and imp_total / imp_trib repeat on every rate row of a document. Never sum the " +
  "rows: `totals` has the period's figures, signed (NC subtracted) and with each " +
  "document counted once (neto, iva, imp_trib, imp_total, per_rate by alícuota). " +
  "A document without items (e.g. imported from ARCA) comes as one row with " +
  "iva_rate_id null; `totals.per_rate` counts it under the alícuota its IVA / " +
  "neto gives, as the printed book and the TXT do, or under 'Sin alícuota' " +
  "when no rate fits. A B or C purchase has no discriminated IVA: it counts " +
  "under 'Sin discriminar (B/C)' with the IVA inside its neto, never as 0%, " +
  "and the TXT declares it with no alícuota.";

/** The period's signed totals of a libro IVA, per alícuota labelled. `neto`
 *  is the discriminated net: a B/C purchase's amount (IVA inside) stays in its
 *  own `per_rate` bucket and out of it. */
function libroIvaTotals(t: {
  count: number;
  per_rate: PerRate;
  imp_trib: number;
  imp_total: number;
}) {
  const rates = Object.entries(t.per_rate)
    .map(([id, v]) => ({ id: Number(id), ...v }))
    .sort((a, b) => a.id - b.id);
  return {
    documents: t.count,
    neto: round2(
      rates
        .filter((r) => r.id !== SIN_DISCRIMINAR)
        .reduce((acc, r) => acc + r.neto, 0),
    ),
    iva: round2(rates.reduce((acc, r) => acc + r.iva, 0)),
    imp_trib: round2(t.imp_trib),
    imp_total: round2(t.imp_total),
    per_rate: rates.map((r) => ({
      alicuota: perRateLabel(r.id),
      neto: round2(r.neto),
      iva: round2(r.iva),
    })),
  };
}

export async function runLibroIvaVentas(input: {
  period: string;
}): Promise<AiRunResult> {
  const res = await listLibroIvaVentasAction({ period: input.period });
  if (!res.ok) return errResult(res.error);
  const sums = computeTotals(groupByInvoice(res.data));
  const totals = {
    ...libroIvaTotals(sums),
    imp_op_ex: round2(sums.imp_op_ex),
    imp_tot_conc: round2(sums.imp_tot_conc),
  };
  return okResult(
    `${SCOPE_LABEL.fiscal}: VAT Sales ${input.period}: ${totals.documents} documents (${res.data.length} rows, one per document × rate) · ` +
      `IVA débito ${money(totals.iva)} · neto ${money(totals.neto)} · total ${money(totals.imp_total)} (NC subtracted).`,
    {
      rows: res.data.map((r) => ({
        comprobante: formatInvoiceNumero(
          r.kind,
          r.letter,
          r.punto_venta,
          r.numero,
        ),
        ...r,
      })),
      totals,
    },
    {
      currency: "ARS",
      note: LIBRO_IVA_CAPTION,
      modelNote: LIBRO_IVA_MODEL_NOTE,
    },
  );
}

export const getLibroIvaVentas = defineAiAction({
  name: "getLibroIvaVentas",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["libro_iva_ventas"],
  description:
    "VAT Sales book (RG 1361) for a YYYY-MM period, fiscal channels only: " +
    "`rows` (net/VAT per document × rate) and `totals`, whose `iva` is the " +
    "period's output VAT (IVA débito); `neto` is the taxed net only, " +
    "`imp_op_ex` (exento) and `imp_tot_conc` (no gravado) come apart. " +
    LIBRO_IVA_ROWS_RULE +
    " Amounts in ARS at each document's own exchange rate; *_orig, moneda and " +
    "cotizacion keep the original currency. `comprobante` is the readable " +
    "document number (e.g. A0003-00022271): use it as a chart's x axis; the " +
    "chart labels the axis with each document's date and shows the " +
    "counterparty and date on hover.",
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
  const sums = computeComprasTotals(groupComprasByInvoice(res.data));
  const totals = {
    ...libroIvaTotals(sums),
    sin_discriminar: round2(sums.per_rate[SIN_DISCRIMINAR]?.neto ?? 0),
  };
  return okResult(
    `${SCOPE_LABEL.fiscal}: VAT Purchases ${input.period}: ${totals.documents} documents (${res.data.length} rows, one per document × rate) · ` +
      `IVA crédito ${money(totals.iva)} · neto ${money(totals.neto)} · sin discriminar (B/C, IVA incluido) ${money(totals.sin_discriminar)} · otros tributos ${money(totals.imp_trib)} · total ${money(totals.imp_total)} (NC subtracted).`,
    {
      rows: res.data.map((r) => ({
        comprobante: formatInvoiceNumber(r),
        ...r,
      })),
      totals,
    },
    {
      currency: "ARS",
      note: LIBRO_IVA_CAPTION,
      modelNote: LIBRO_IVA_MODEL_NOTE,
    },
  );
}

export const getLibroIvaCompras = defineAiAction({
  name: "getLibroIvaCompras",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["libro_iva_compras"],
  description:
    "VAT Purchases book (RG 1361) for a YYYY-MM period, fiscal channels only: " +
    "`rows` (one per purchase invoice × rate) and `totals`, whose `iva` is " +
    "the period's input VAT (IVA crédito); `neto` is the discriminated net " +
    "(the alícuota buckets) only, and `sin_discriminar` comes apart: the " +
    "B/C purchases' amount with their IVA inside, never net. imp_trib is the sum of perc_iva " +
    "(IVA perceptions), perc_iibb, perc_nacionales (Ganancias and other " +
    "national taxes, not IVA), perc_municipales and impuestos_internos. " +
    LIBRO_IVA_ROWS_RULE +
    " Amounts in ARS at each document's own exchange rate; *_orig, moneda and " +
    "cotizacion keep the original currency. `comprobante` is the readable " +
    "document number (e.g. A0003-00022271): use it as a chart's x axis; the " +
    "chart labels the axis with each document's date and shows the " +
    "counterparty and date on hover.",
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
    // The action refuses past 500; a bounded page reports `partial` instead.
    limit: Math.min(200, Math.max(1, Math.trunc(input.limit ?? 25))),
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
    limit: z.number().nullish().describe("Max entries (default 25, max 200)."),
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
