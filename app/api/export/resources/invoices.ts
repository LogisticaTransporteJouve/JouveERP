import "server-only";

import {
  INVOICE_STATUS_LABEL,
  formatInvoiceNumero,
  isInvoiceStatus,
} from "@/features/invoices/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

// Landscape A4 ≈ 794pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 80, mono: true },
  { header: "Comprobante", width: 150, mono: true },
  { header: "Cliente", width: 264 },
  { header: "Estado", width: 110 },
  { header: "Total", width: 130, align: "right", mono: true },
];

type ClientJoin = { legal_name: string };

export const invoices: Exporter = {
  permission: "invoices:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("invoices")
        .select(
          "kind, letter, punto_venta, numero, fecha, imp_total, status, clients!inner(legal_name)",
        )
        .order("fecha", { ascending: true })
        .order("numero", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("fecha", range.from);
      if (range.to) query = query.lte("fecha", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load invoices.");

    let total = 0;
    const rows = (data ?? []).map((row) => {
      const client: ClientJoin = row.clients;
      const status = isInvoiceStatus(row.status) ? row.status : "draft";
      const amount = Number(row.imp_total);
      total += amount;
      return [
        formatArgentineDate(row.fecha),
        formatInvoiceNumero(row.kind, row.letter, row.punto_venta, row.numero),
        client.legal_name,
        INVOICE_STATUS_LABEL[status],
        money(amount),
      ];
    });

    return {
      title: "Comprobantes",
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "", "Total", money(total)],
      orientation: "landscape",
      fileName: "comprobantes",
    };
  },
};
