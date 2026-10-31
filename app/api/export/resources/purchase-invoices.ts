import "server-only";

import {
  PURCHASE_INVOICE_LETTERS,
  PURCHASE_INVOICE_STATUS_LABEL,
  formatInvoiceNumber,
  isPurchaseInvoiceKind,
  isPurchaseInvoiceStatus,
  type PurchaseInvoiceLetter,
} from "@/features/purchase-invoices/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  channelCell,
  dateCell,
  exportScope,
  money,
  moneyCell,
  scopedSubtitle,
  type Exporter,
} from "../shared";

const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 70, mono: true },
  { header: "Comprobante", width: 140, mono: true },
  { header: "Proveedor", width: 190 },
  { header: "Canal", width: 110 },
  { header: "Estado", width: 80 },
  { header: "Total", width: 104, align: "right", mono: true },
];

type SupplierJoin = { legal_name: string; cuit: string };

function isLetter(value: string): value is PurchaseInvoiceLetter {
  return PURCHASE_INVOICE_LETTERS.some((letter) => letter === value);
}

function asLetter(value: string | null): PurchaseInvoiceLetter | null {
  return value !== null && isLetter(value) ? value : null;
}

export const purchaseInvoices: Exporter = {
  permission: "purchase_invoices:read",
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = applyFiscalFilter(
        supabase
          .from("purchase_invoices")
          .select(
            "kind, letter, punto_venta, numero, fecha, imp_total, moneda, status, suppliers!inner(legal_name, cuit), channel:invoicing_channels(name, is_fiscal)",
          ),
        isFiscal,
        "channel",
      )
        .order("fecha", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("fecha", range.from);
      if (range.to) query = query.lte("fecha", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load purchase invoices.");

    let total = 0;
    const rows = (data ?? []).map((row) => {
      const supplier: SupplierJoin = row.suppliers;
      const kind = isPurchaseInvoiceKind(row.kind) ? row.kind : "factura";
      const status = isPurchaseInvoiceStatus(row.status)
        ? row.status
        : "received";
      const amount = Number(row.imp_total);
      total += amount;
      const symbol = row.moneda === "PES" ? "$" : "US$";
      return [
        dateCell(row.fecha),
        formatInvoiceNumber({
          kind,
          letter: asLetter(row.letter),
          punto_venta: row.punto_venta,
          numero: row.numero,
        }),
        `${supplier.legal_name} (CUIT ${supplier.cuit})`,
        channelCell(row.channel),
        PURCHASE_INVOICE_STATUS_LABEL[status],
        moneyCell(amount, {
          currency: row.moneda === "PES" ? "ARS" : "USD",
          text: `${symbol}${money(amount).slice(1)}`,
        }),
      ];
    });

    return {
      title: "Facturas de compra",
      subtitle: scopedSubtitle(scope),
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "", "", "Total", moneyCell(total)],
      orientation: "landscape",
      fileName: "facturas-de-compra",
    };
  },
};
