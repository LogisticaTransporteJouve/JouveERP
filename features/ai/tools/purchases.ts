import { tool } from "ai";
import { z } from "zod";

import { listPaymentOrdersAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import { searchSuppliersAction } from "@/features/suppliers/actions/suppliers-actions";

import { type AiToolResult, errResult, money, okResult } from "./result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`purchase_invoices:read` / `suppliers:read` / `payment_orders:read`) + RLS.

export async function runPurchaseInvoices(input: {
  query?: string | null;
  supplierId?: string | null;
  channelId?: string | null;
  fechaFrom?: string | null;
  fechaTo?: string | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await searchPurchaseInvoicesAction({
    query: input.query ?? "",
    supplierId: input.supplierId ?? null,
    channelId: input.channelId ?? null,
    fechaFrom: input.fechaFrom ?? null,
    fechaTo: input.fechaTo ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  const total = res.data.invoices.reduce((s, i) => s + i.imp_total, 0);
  return okResult(
    `${res.data.invoices.length} purchase invoices${
      res.data.nextOffset !== null ? " (more available, narrow the filter)" : ""
    } · total ${money(total)}.`,
    res.data,
  );
}

export const getPurchaseInvoices = tool({
  description:
    "Purchase invoices (expenses/suppliers): list filterable by supplier/number " +
    "(query), channel and date range (YYYY-MM-DD). Returns number, supplier, " +
    "date, net/VAT/total and status. For purchases, expenses or VAT credit.",
  inputSchema: z.object({
    query: z
      .string()
      .nullish()
      .describe("Text to search: number or supplier name."),
    supplierId: z.string().nullish().describe("Supplier UUID, optional."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    fechaFrom: z.string().nullish().describe("Date from YYYY-MM-DD."),
    fechaTo: z.string().nullish().describe("Date to YYYY-MM-DD."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  execute: (input) => runPurchaseInvoices(input),
});

export async function runSupplierAging(): Promise<AiToolResult> {
  const res = await getSupplierAgingAction();
  if (!res.ok) return errResult(res.error);
  const totalOpen = res.data.reduce((s, r) => s + r.total_open, 0);
  const plus90 = res.data.reduce((s, r) => s + r.bucket_90_plus, 0);
  return okResult(
    `${res.data.length} suppliers with balance · total payable ${money(totalOpen)} · ` +
      `+90 days ${money(plus90)}.`,
    res.data,
  );
}

export const getSupplierAging = tool({
  description:
    "Accounts payable aging: outstanding balance with each supplier per bucket " +
    "(0-30 / 30-60 / 60-90 / +90 days), with totals. No parameters. For " +
    "'how much do I owe?', 'who do I owe the most to?' or planning payments.",
  inputSchema: z.object({}),
  execute: () => runSupplierAging(),
});

export async function runPaymentOrders(input: {
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await listPaymentOrdersAction({ limit: input.limit ?? 50 });
  if (!res.ok) return errResult(res.error);
  const total = res.data.items.reduce((s, o) => s + o.total_amount, 0);
  return okResult(
    `${res.data.items.length} payment orders${
      res.data.nextOffset !== null ? " (more available)" : ""
    } · total paid ${money(total)}.`,
    res.data,
  );
}

export const getPaymentOrders = tool({
  description:
    "Payment orders issued to suppliers: the most recent ones with supplier, " +
    "date, amount, currency and status. For viewing payments made.",
  inputSchema: z.object({
    limit: z.number().nullish().describe("Max rows (default 50)."),
  }),
  execute: (input) => runPaymentOrders(input),
});

export async function runSearchSuppliers(input: {
  query?: string | null;
  onlyActive?: boolean | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await searchSuppliersAction({
    query: input.query ?? "",
    onlyActive: input.onlyActive ?? true,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.suppliers.length} suppliers${
      res.data.nextOffset !== null ? " (more available, refine the search)" : ""
    }.`,
    res.data,
  );
}

export const searchSuppliers = tool({
  description:
    "Search suppliers by name or CUIT (full-text). Returns each supplier's data " +
    "(legal name, CUIT, VAT condition, contact). Useful to find the supplier_id " +
    "other tools require or to resolve who the user is referring to.",
  inputSchema: z.object({
    query: z.string().nullish().describe("Text to search: name or CUIT."),
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Active only (default true)."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  execute: (input) => runSearchSuppliers(input),
});
