import "server-only";

import { formatReceiptNumber } from "@/features/receipts/schema";
import { logger } from "@/lib/logger";
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

/** PostgREST embeds the related client as a single nested object. */
function clientName(client: { legal_name: string } | null): string {
  return client?.legal_name ?? "—";
}

const RECEIPTS_COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 70, mono: true },
  { header: "Recibo", width: 110, mono: true },
  { header: "Cliente", width: 140 },
  { header: "Canal", width: 80 },
  { header: "Estado", width: 60 },
  { header: "Total", width: 87, align: "right", mono: true },
];

const STATUS_LABEL: Record<string, string> = {
  issued: "Emitido",
  canceled: "Anulado",
};

export const receipts: Exporter = {
  permission: "receipts:read",
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const supabase = await createClient();
    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = applyFiscalFilter(
        supabase
          .from("receipts")
          .select(
            "punto_venta, numero, receipt_date, total_amount, currency, status, clients ( legal_name ), channel:invoicing_channels ( name, is_fiscal )",
          ),
        isFiscal,
        "channel",
      )
        .order("receipt_date", { ascending: true })
        .order("numero", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("receipt_date", range.from);
      if (range.to) query = query.lte("receipt_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
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
      const formattedTotal = moneyCell(amount, {
        currency: r.currency,
        text:
          r.currency === "ARS"
            ? money(amount)
            : `${money(amount)} ${r.currency}`,
      });
      return [
        dateCell(r.receipt_date),
        formatReceiptNumber(r.punto_venta, r.numero),
        clientName(r.clients),
        channelCell(r.channel),
        STATUS_LABEL[r.status] ?? r.status,
        formattedTotal,
      ];
    });

    return {
      title: "Recibos",
      subtitle: scopedSubtitle(scope),
      columns: RECEIPTS_COLUMNS,
      rows,
      totalsRow: ["", "", "", "", "Total (ARS)", moneyCell(total)],
      fileName: "recibos",
    };
  },
};
