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
    `${res.data.invoices.length} facturas de compra${
      res.data.nextOffset !== null ? " (hay más, acotá el filtro)" : ""
    } · total ${money(total)}.`,
    res.data,
  );
}

export const getPurchaseInvoices = tool({
  description:
    "Facturas de compra (gastos/proveedores): listado filtrable por proveedor/" +
    "número (query), canal y rango de fechas (YYYY-MM-DD). Devuelve número, " +
    "proveedor, fecha, neto/IVA/total y estado. Para compras, gastos o IVA crédito.",
  inputSchema: z.object({
    query: z
      .string()
      .nullish()
      .describe("Texto a buscar: número o nombre del proveedor."),
    supplierId: z.string().nullish().describe("UUID del proveedor, opcional."),
    channelId: z.string().nullish().describe("UUID del canal, opcional."),
    fechaFrom: z.string().nullish().describe("Fecha desde YYYY-MM-DD."),
    fechaTo: z.string().nullish().describe("Fecha hasta YYYY-MM-DD."),
    limit: z.number().nullish().describe("Máximo de filas (default 25, máx 200)."),
  }),
  execute: (input) => runPurchaseInvoices(input),
});

export async function runSupplierAging(): Promise<AiToolResult> {
  const res = await getSupplierAgingAction();
  if (!res.ok) return errResult(res.error);
  const totalOpen = res.data.reduce((s, r) => s + r.total_open, 0);
  const plus90 = res.data.reduce((s, r) => s + r.bucket_90_plus, 0);
  return okResult(
    `${res.data.length} proveedores con saldo · total a pagar ${money(totalOpen)} · ` +
      `+90 días ${money(plus90)}.`,
    res.data,
  );
}

export const getSupplierAging = tool({
  description:
    "Aging de cuentas por pagar: saldo pendiente con cada proveedor por bucket " +
    "(0-30 / 30-60 / 60-90 / +90 días), con totales. Sin parámetros. Para " +
    "'¿cuánto debo?', '¿a quién le debo más?' o planificar pagos.",
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
    `${res.data.items.length} órdenes de pago${
      res.data.nextOffset !== null ? " (hay más)" : ""
    } · total pagado ${money(total)}.`,
    res.data,
  );
}

export const getPaymentOrders = tool({
  description:
    "Órdenes de pago emitidas a proveedores: las más recientes con proveedor, " +
    "fecha, importe, moneda y estado. Para ver pagos realizados.",
  inputSchema: z.object({
    limit: z.number().nullish().describe("Máximo de filas (default 50)."),
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
    `${res.data.suppliers.length} proveedores${
      res.data.nextOffset !== null ? " (hay más, afiná la búsqueda)" : ""
    }.`,
    res.data,
  );
}

export const searchSuppliers = tool({
  description:
    "Busca proveedores por nombre o CUIT (full-text). Devuelve datos de cada " +
    "proveedor (razón social, CUIT, condición IVA, contacto). Útil para encontrar " +
    "el supplier_id que piden otras tools o resolver a quién se refiere el usuario.",
  inputSchema: z.object({
    query: z.string().nullish().describe("Texto a buscar: nombre o CUIT."),
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Solo activos (default true)."),
    limit: z.number().nullish().describe("Máximo de filas (default 25, máx 200)."),
  }),
  execute: (input) => runSearchSuppliers(input),
});
