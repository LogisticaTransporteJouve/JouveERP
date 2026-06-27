import "server-only";

import {
  PURCHASE_INVOICE_LETTERS,
  PURCHASE_INVOICE_STATUS_LABEL,
  formatInvoiceNumber,
  isPurchaseInvoiceKind,
  isPurchaseInvoiceStatus,
  type PurchaseInvoiceLetter,
} from "@/features/purchase-invoices/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 70, mono: true },
  { header: "Comprobante", width: 140, mono: true },
  { header: "Proveedor", width: 230 },
  { header: "Tipo", width: 70 },
  { header: "Estado", width: 80 },
  { header: "Total", width: 104, align: "right", mono: true },
];

type SupplierJoin = { legal_name: string; cuit: string };
type ChannelJoin = { is_fiscal: boolean };

function isLetter(value: string): value is PurchaseInvoiceLetter {
  return PURCHASE_INVOICE_LETTERS.some((letter) => letter === value);
}

function asLetter(value: string | null): PurchaseInvoiceLetter | null {
  return value !== null && isLetter(value) ? value : null;
}

export const purchaseInvoices: Exporter = {
  permission: "purchase_invoices:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("purchase_invoices")
      .select(
        "kind, letter, punto_venta, numero, fecha, imp_total, moneda, status, suppliers!inner(legal_name, cuit), invoicing_channels!inner(is_fiscal)",
      )
      .order("fecha", { ascending: true });

    if (range.from) query = query.gte("fecha", range.from);
    if (range.to) query = query.lte("fecha", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar las facturas de compra.");

    let total = 0;
    const rows = (data ?? []).map((row) => {
      const supplier: SupplierJoin = row.suppliers;
      const channel: ChannelJoin = row.invoicing_channels;
      const kind = isPurchaseInvoiceKind(row.kind) ? row.kind : "factura";
      const status = isPurchaseInvoiceStatus(row.status)
        ? row.status
        : "received";
      const amount = Number(row.imp_total);
      total += amount;
      const currency = row.moneda === "PES" ? "$" : "US$";
      return [
        formatArgentineDate(row.fecha),
        formatInvoiceNumber({
          kind,
          letter: asLetter(row.letter),
          punto_venta: row.punto_venta,
          numero: row.numero,
        }),
        `${supplier.legal_name} (CUIT ${supplier.cuit})`,
        channel.is_fiscal ? "Fiscal" : "Interno",
        PURCHASE_INVOICE_STATUS_LABEL[status],
        `${currency}${money(amount).slice(1)}`,
      ];
    });

    return {
      title: "Facturas de compra",
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "", "", "Total", money(total)],
      orientation: "landscape",
      fileName: "facturas-de-compra",
    };
  },
};
