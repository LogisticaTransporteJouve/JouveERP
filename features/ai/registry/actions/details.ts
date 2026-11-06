import { z } from "zod";

import { getInvoiceDetailAction } from "@/features/invoices/actions/invoices-actions";
import { getPaymentOrderByIdAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { getPurchaseImputationsAction } from "@/features/purchase-invoices/actions/impute-remitos-actions";
import {
  getPurchaseInvoiceAllocationsAction,
  getPurchaseInvoiceByIdAction,
  getPurchaseInvoiceItemsAction,
} from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { getReceiptByIdAction } from "@/features/receipts/actions/receipts-actions";
import { UuidSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, okResult } from "../result";

// The detail page of each document (/invoices/[id], /receipts/[id],
// /payment-orders/[id], /purchases/[id]), one tool per kind so each declares
// exactly the permission its read action checks. The id comes from the list
// tools (getInvoices, getReceipts, getPaymentOrders, getPurchaseInvoices).

const NOT_FOUND = "No existe ese documento o no podés verlo.";

function number(pv: number, numero: number | null): string {
  return numero === null
    ? "sin número"
    : `${String(pv).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

const idInput = (what: string) =>
  z.object({ id: UuidSchema.describe(`UUID ${what}.`) });

export const getInvoiceDetail = defineAiAction({
  name: "getInvoiceDetail",
  domain: "ventas",
  permission: "invoices:read",
  sideEffect: "read",
  sources: ["invoices", "invoice_items"],
  description:
    "Detalle de UN comprobante de venta (factura, NC o ND) por su UUID (de getInvoices): cliente, canal, fecha, vencimiento, ítems con neto/IVA/total, importes, moneda y cotización, CAE y su vencimiento, observaciones de AFIP y estado.",
  input: idInput("del comprobante"),
  run: async (_ctx, input) => {
    const res = await getInvoiceDetailAction(input.id);
    if (!res.ok) return errResult(res.error);
    if (!res.data) return errResult(NOT_FOUND);
    const d = res.data;
    return okResult(
      `${d.kind.toUpperCase()} ${d.letter} ${number(d.punto_venta, d.numero)} · ${d.client.legal_name} · ${d.fecha} · ` +
        `${d.moneda} ${d.imp_total.toLocaleString("es-AR")} · ${d.items.length} ítem(s) · ${d.status}` +
        (d.cae ? ` · CAE ${d.cae}` : " · sin CAE") +
        ` · canal ${d.channel.name}.`,
      d,
    );
  },
});

export const getReceiptDetail = defineAiAction({
  name: "getReceiptDetail",
  domain: "ventas",
  permission: "receipts:read",
  sideEffect: "read",
  sources: [
    "receipts",
    "receipt_payment_lines",
    "receipt_allocations",
    "receipt_retentions",
  ],
  description:
    "Detalle de UN recibo de cobro por su UUID (de getReceipts): fecha, moneda y total, medios de pago (con sus cheques), a qué facturas y cheques rechazados se imputó, retenciones sufridas y estado.",
  input: idInput("del recibo"),
  run: async (_ctx, input) => {
    const res = await getReceiptByIdAction(input.id);
    if (!res.ok) return errResult(res.error);
    if (!res.data) return errResult(NOT_FOUND);
    const r = res.data.receipt;
    return okResult(
      `Recibo ${number(r.punto_venta, r.numero)} · ${r.receipt_date} · ${r.currency} ${r.total_amount.toLocaleString("es-AR")} · ` +
        `${res.data.payment_lines.length} medio(s) de pago · ${res.data.allocations.length} imputación(es) · ` +
        `${res.data.retentions.length} retención(es) · ${r.status}.`,
      res.data,
    );
  },
});

export const getPaymentOrderDetail = defineAiAction({
  name: "getPaymentOrderDetail",
  domain: "compras",
  permission: "payment_orders:read",
  sideEffect: "read",
  sources: [
    "payment_orders",
    "payment_order_payment_lines",
    "payment_order_allocations",
  ],
  description:
    "Detalle de UNA orden de pago por su UUID (de getPaymentOrders): proveedor, fecha, moneda y total, medios de pago, a qué facturas y cheques rechazados se imputó y estado.",
  input: idInput("de la orden de pago"),
  run: async (_ctx, input) => {
    const res = await getPaymentOrderByIdAction(input.id);
    if (!res.ok) return errResult(res.error);
    if (!res.data) return errResult(NOT_FOUND);
    const op = res.data.paymentOrder;
    return okResult(
      `OP ${number(op.punto_venta, op.numero)} · ${op.supplier_legal_name} · ${op.payment_date} · ` +
        `${op.currency} ${op.total_amount.toLocaleString("es-AR")} · ${res.data.payment_lines.length} medio(s) de pago · ` +
        `${res.data.allocations.length} imputación(es) · ${op.status}.`,
      res.data,
    );
  },
});

export const getPurchaseInvoiceDetail = defineAiAction({
  name: "getPurchaseInvoiceDetail",
  domain: "compras",
  permission: "purchase_invoices:read",
  sideEffect: "read",
  sources: [
    "purchase_invoices",
    "purchase_invoice_items",
    "payment_order_allocations",
    "purchase_invoices (remitos)",
  ],
  description:
    "Detalle de UNA factura de compra (o NC/ND de proveedor) por su UUID (de getPurchaseInvoices): proveedor, fecha, vencimiento, importes (neto, IVA, percepciones, total), moneda, CAE del proveedor, ítems, las órdenes de pago que la cancelaron y los remitos imputados.",
  input: idInput("de la factura de compra"),
  run: async (_ctx, input) => {
    const [invoice, items, allocations, imputations] = await Promise.all([
      getPurchaseInvoiceByIdAction(input.id),
      getPurchaseInvoiceItemsAction(input.id),
      getPurchaseInvoiceAllocationsAction(input.id),
      getPurchaseImputationsAction(input.id),
    ]);
    if (!invoice.ok) return errResult(invoice.error);
    if (!invoice.data) return errResult(NOT_FOUND);
    if (!items.ok) return errResult(items.error);
    if (!allocations.ok) return errResult(allocations.error);
    if (!imputations.ok) return errResult(imputations.error);
    const p = invoice.data;
    return okResult(
      `${p.kind.toUpperCase()} ${p.letter} ${number(p.punto_venta, p.numero)} · ${p.supplier_legal_name} · ${p.fecha} · ` +
        `${p.moneda} ${p.imp_total.toLocaleString("es-AR")} · ${items.data.length} ítem(s) · ` +
        `${allocations.data.length} pago(s) imputado(s) · ${p.status}.`,
      {
        invoice: p,
        items: items.data,
        allocations: allocations.data,
        imputations: imputations.data,
      },
    );
  },
});
