import "server-only";

import {
  TRANSACTION_KIND_LABEL,
  isTransactionKind,
  type TransactionKind,
} from "@/features/transactions/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { formatArgentineDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

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
    let query = supabase
      .from("v_transactions_tagged")
      .select(
        "kind, amount, transaction_date, description, account_name, channel_name",
      )
      .order("transaction_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (range.from) query = query.gte("transaction_date", range.from);
    if (range.to) query = query.lte("transaction_date", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar los movimientos.");

    let net = 0;
    const rows: string[][] = [];
    for (const row of data ?? []) {
      if (!isTransactionKind(row.kind)) continue;
      const amount = Number(row.amount ?? 0);
      const outflow = isOutflow(row.kind);
      net += (outflow ? -1 : 1) * amount;
      rows.push([
        formatArgentineDate(row.transaction_date),
        TRANSACTION_KIND_LABEL[row.kind],
        row.account_name ?? "—",
        row.channel_name ?? "—",
        row.description ?? "—",
        `${outflow ? "-" : "+"}${money(amount)}`,
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
        `${net < 0 ? "-" : "+"}${money(Math.abs(net))}`,
      ],
      orientation: "landscape",
      fileName: "caja-movimientos",
    };
  },
};
