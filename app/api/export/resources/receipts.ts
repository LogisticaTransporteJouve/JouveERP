import "server-only";

import { formatReceiptNumber } from "@/features/receipts/schema";
import { formatArgentineDate } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

/** PostgREST embeds the related client as a single nested object. */
function clientName(client: { legal_name: string } | null): string {
  return client?.legal_name ?? "—";
}

const RECEIPTS_COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 70, mono: true },
  { header: "Recibo", width: 110, mono: true },
  { header: "Cliente", width: 200 },
  { header: "Estado", width: 80 },
  { header: "Total", width: 87, align: "right", mono: true },
];

const STATUS_LABEL: Record<string, string> = {
  issued: "Emitido",
  canceled: "Anulado",
};

export const receipts: Exporter = {
  permission: "receipts:read",
  load: async (_params, range) => {
    const supabase = await createClient();
    let query = supabase
      .from("receipts")
      .select(
        "punto_venta, numero, receipt_date, total_amount, currency, status, clients ( legal_name )",
      )
      .order("receipt_date", { ascending: true })
      .order("numero", { ascending: true });

    if (range.from) query = query.gte("receipt_date", range.from);
    if (range.to) query = query.lte("receipt_date", range.to);

    const { data, error } = await query;
    if (error) {
      logger.error("export.receipts.failed", { error });
      throw new Error("Could not load receipts.");
    }

    let total = 0;
    const rows = (data ?? []).map((r) => {
      // Only ARS totals are summed; the on-screen list mixes currencies, so we
      // tag non-ARS amounts with their code and exclude them from the total.
      const amount = Number(r.total_amount);
      if (r.currency === "ARS") total += amount;
      const formattedTotal =
        r.currency === "ARS" ? money(amount) : `${money(amount)} ${r.currency}`;
      return [
        formatArgentineDate(r.receipt_date),
        formatReceiptNumber(r.punto_venta, r.numero),
        clientName(r.clients),
        STATUS_LABEL[r.status] ?? r.status,
        formattedTotal,
      ];
    });

    return {
      title: "Recibos",
      columns: RECEIPTS_COLUMNS,
      rows,
      totalsRow: ["", "", "", "Total (ARS)", money(total)],
      fileName: "recibos",
    };
  },
};
