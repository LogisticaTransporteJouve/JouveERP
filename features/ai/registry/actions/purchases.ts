import { z } from "zod";

import { listPaymentOrdersAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { listSupplierCategoriesAction } from "@/features/supplier-categories/actions/supplier-categories-actions";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import {
  getSupplierPriceEvolutionAction,
  getSupplierPurchasesSummaryAction,
  getSupplierUpcomingDuesAction,
} from "@/features/suppliers/actions/purchases-report-actions";
import { searchSuppliersAction } from "@/features/suppliers/actions/suppliers-actions";
import {
  SupplierPriceEvolutionInputSchema,
  SupplierPurchasesSummaryInputSchema,
  SupplierUpcomingDuesInputSchema,
} from "@/features/suppliers/reports-schema";

import { defineAiAction } from "../define";
import {
  type AiRunResult,
  errResult,
  money,
  okResult,
  reachedCap,
} from "../result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`purchase_invoices:read` / `suppliers:read` / `payment_orders:read`) + RLS.

export async function runPurchaseInvoices(input: {
  query?: string | null;
  supplierId?: string | null;
  channelId?: string | null;
  fechaFrom?: string | null;
  fechaTo?: string | null;
  limit?: number | null;
}): Promise<AiRunResult> {
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
    { partial: res.data.nextOffset !== null },
  );
}

export const getPurchaseInvoices = defineAiAction({
  name: "getPurchaseInvoices",
  domain: "compras",
  permission: "purchase_invoices:read",
  sideEffect: "read",
  sources: ["search_purchase_invoices"],
  description:
    "Purchase invoices (expenses/suppliers): list filterable by supplier/number " +
    "(query), channel and date range (YYYY-MM-DD). Returns number, supplier, " +
    "date, net/VAT/total and status. For purchases, expenses or VAT credit.",
  input: z.object({
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
  run: (_ctx, input) => runPurchaseInvoices(input),
});

export async function runSupplierAging(): Promise<AiRunResult> {
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

export const getSupplierAging = defineAiAction({
  name: "getSupplierAging",
  domain: "compras",
  permission: "suppliers:read",
  sideEffect: "read",
  sources: ["v_supplier_aging"],
  description:
    "Accounts payable aging: outstanding balance with each supplier per bucket " +
    "(0-30 / 30-60 / 60-90 / +90 days), with totals. No parameters. For " +
    "'how much do I owe?', 'who do I owe the most to?' or planning payments.",
  input: z.object({}),
  run: () => runSupplierAging(),
});

export async function runPaymentOrders(input: {
  limit?: number | null;
}): Promise<AiRunResult> {
  const res = await listPaymentOrdersAction({ limit: input.limit ?? 50 });
  if (!res.ok) return errResult(res.error);
  const total = res.data.items.reduce((s, o) => s + o.total_amount, 0);
  return okResult(
    `${res.data.items.length} payment orders${
      res.data.nextOffset !== null ? " (more available)" : ""
    } · total paid ${money(total)}.`,
    res.data,
    { partial: res.data.nextOffset !== null },
  );
}

export const getPaymentOrders = defineAiAction({
  name: "getPaymentOrders",
  domain: "compras",
  permission: "payment_orders:read",
  sideEffect: "read",
  sources: ["payment_orders"],
  description:
    "Payment orders issued to suppliers: the most recent ones with supplier, " +
    "date, amount, currency and status. For viewing payments made.",
  input: z.object({
    limit: z.number().nullish().describe("Max rows (default 50)."),
  }),
  run: (_ctx, input) => runPaymentOrders(input),
});

export async function runSearchSuppliers(input: {
  query?: string | null;
  onlyActive?: boolean | null;
  limit?: number | null;
}): Promise<AiRunResult> {
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
    { partial: res.data.nextOffset !== null },
  );
}

export const searchSuppliers = defineAiAction({
  name: "searchSuppliers",
  domain: "compras",
  permission: "suppliers:read",
  sideEffect: "read",
  sources: ["search_suppliers"],
  description:
    "Search suppliers by name or CUIT (full-text). Returns each supplier's data " +
    "(legal name, CUIT, VAT condition, contact). Useful to find the supplier_id " +
    "other tools require or to resolve who the user is referring to.",
  input: z.object({
    query: z.string().nullish().describe("Text to search: name or CUIT."),
    onlyActive: z.boolean().nullish().describe("Active only (default true)."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  run: (_ctx, input) => runSearchSuppliers(input),
});

export const getSupplierPurchasesSummary = defineAiAction({
  name: "getSupplierPurchasesSummary",
  domain: "compras",
  permission: [
    "suppliers:read",
    "purchase_invoices:read",
    "payment_orders:read",
  ],
  sideEffect: "read",
  sources: [
    "ai_supplier_purchases_summary",
    "purchase_invoices",
    "payment_orders",
    "v_supplier_aging_documents",
  ],
  description:
    "Ranking de proveedores en un rango de fechas: comprado en ARS (total y neto, NC restan), pagado por moneda, deuda abierta y vencida actual y próximo vencimiento, con totales. Filtrable por proveedor o categoría.",
  input: SupplierPurchasesSummaryInputSchema,
  run: async (_ctx, input) => {
    const res = await getSupplierPurchasesSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    const first = res.data[0];
    const suppliers = first?.total_suppliers ?? 0;
    return okResult(
      `Proveedores ${input.from}→${input.to}: ${suppliers} · comprado ${money(
        first?.total_purchased_ars ?? 0,
      )} · deuda abierta ARS ${money(first?.total_open_ars ?? 0)}` +
        (suppliers > res.data.length
          ? ` (se muestran ${res.data.length}).`
          : "."),
      { rows: res.data },
      {
        currency: "ARS",
        partial: suppliers > res.data.length,
        note: "Pagos en USD y deuda en moneda extranjera van aparte (paid_usd, open_foreign), sin convertir.",
      },
    );
  },
});

export const getSupplierUpcomingDues = defineAiAction({
  name: "getSupplierUpcomingDues",
  domain: "compras",
  permission: [
    "suppliers:read",
    "purchase_invoices:read",
    "payment_orders:read",
  ],
  sideEffect: "read",
  sources: [
    "ai_supplier_upcoming_dues",
    "v_supplier_aging_documents",
    "suppliers",
  ],
  description:
    "Facturas de proveedores con saldo que vencen en los próximos N días (incluye las ya vencidas), de la más próxima a la más lejana. Vencimiento: fecha de vto. o fecha + plazo del proveedor.",
  input: SupplierUpcomingDuesInputSchema,
  run: async (_ctx, input) => {
    const res = await getSupplierUpcomingDuesAction(input);
    if (!res.ok) return errResult(res.error);
    const first = res.data[0];
    const total = first?.total_documents ?? 0;
    const overdue = res.data.filter((r) => r.days_to_due < 0).length;
    return okResult(
      `${total} comprobantes a pagar en ${input.days ?? 30} días (${overdue} ya vencidos en la lista) · ARS ${money(
        first?.total_open_ars ?? 0,
      )}` +
        (total > res.data.length ? ` (se muestran ${res.data.length}).` : "."),
      { rows: res.data },
      { currency: "ARS", partial: total > res.data.length },
    );
  },
});

export const getSupplierPriceEvolution = defineAiAction({
  name: "getSupplierPriceEvolution",
  domain: "compras",
  permission: ["suppliers:read", "purchase_invoices:read"],
  sideEffect: "read",
  sources: [
    "ai_supplier_price_evolution",
    "purchase_invoices",
    "purchase_invoice_items",
  ],
  description:
    "Evolución mensual de compras en ARS: por proveedor o por categoría (neto mensual), o por ítem (precio unitario promedio y cantidad; requiere proveedor, categoría o texto del ítem).",
  input: SupplierPriceEvolutionInputSchema,
  run: async (_ctx, input) => {
    const res = await getSupplierPriceEvolutionAction(input);
    if (!res.ok) return errResult(res.error);
    const limit = input.limit ?? 300;
    return okResult(
      `${res.data.length} filas mes×${input.groupBy ?? "supplier"} entre ${input.from} y ${input.to}.`,
      { rows: res.data },
      { currency: "ARS", partial: reachedCap(res.data.length, limit) },
    );
  },
});

export const getSupplierCategories = defineAiAction({
  name: "getSupplierCategories",
  domain: "compras",
  permission: "suppliers:read",
  sideEffect: "read",
  sources: ["supplier_categories"],
  description:
    "Categorías de proveedores (nombre, estado y UUID) para filtrar compras por categoría.",
  input: z.object({}),
  run: async () => {
    const res = await listSupplierCategoriesAction();
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} categorías de proveedores.`, res.data);
  },
});
