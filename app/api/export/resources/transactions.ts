import "server-only";

import {
  TRANSACTION_KIND_LABEL,
  isTransactionKind,
  type TransactionKind,
} from "@/features/transactions/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  dateCell,
  money,
  moneyCell,
  type ExportCell,
  type Exporter,
} from "../shared";

const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 70, mono: true },
  { header: "Tipo", width: 130 },
  { header: "Cuenta", width: 150 },
  { header: "Canal", width: 150 },
  { header: "Descripción", width: 174 },
  { header: "Monto", width: 120, align: "right", mono: true },
];

/** Outflows (egreso / transferencia que sale) reduce the net cash position. */
function isOutflow(kind: TransactionKind): boolean {
  return kind === "expense" || kind === "transfer_out";
}

export const transactions: Exporter = {
  permission: "transactions:read",
  load: async (_params, range) => {
    const supabase = await createClient();
    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("v_transactions_tagged")
        .select(
          "kind, amount, transaction_date, description, account_name, channel_name",
        )
        .order("transaction_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("transaction_date", range.from);
      if (range.to) query = query.lte("transaction_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load transactions.");

    let net = 0;
    const rows: ExportCell[][] = [];
    for (const row of data ?? []) {
      if (!isTransactionKind(row.kind)) continue;
      const amount = Number(row.amount ?? 0);
      const outflow = isOutflow(row.kind);
      net += (outflow ? -1 : 1) * amount;
      rows.push([
        dateCell(row.transaction_date),
        TRANSACTION_KIND_LABEL[row.kind],
        row.account_name ?? "—",
        row.channel_name ?? "—",
        row.description ?? "—",
        moneyCell(outflow ? -amount : amount, {
          text: `${outflow ? "-" : "+"}${money(amount)}`,
        }),
      ]);
    }

    return {
      title: "Caja — Movimientos",
      columns: COLUMNS,
      rows,
      totalsRow: [
        "",
        "",
        "",
        "",
        "Neto",
        moneyCell(net, {
          text: `${net < 0 ? "-" : "+"}${money(Math.abs(net))}`,
        }),
      ],
      orientation: "landscape",
      fileName: "caja-movimientos",
    };
  },
};
