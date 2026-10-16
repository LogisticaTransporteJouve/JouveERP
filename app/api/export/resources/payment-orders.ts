import "server-only";

import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";

import {
  formatPaymentOrderNumber,
  isPaymentOrderCurrency,
} from "@/features/payment-orders/schema";

import {
  dateCell,
  moneyCell,
  type Exporter,
  type ExportRange,
} from "../shared";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

// Landscape A4 ≈ 794pt. Mirrors the on-screen payment-orders table
// (Número, Proveedor, Fecha, Total, Estado) plus an explicit currency column
// because payment orders can be issued in ARS or USD.
const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 80, mono: true },
  { header: "Número", width: 130, mono: true },
  { header: "Proveedor", width: 274 },
  { header: "Moneda", width: 60, align: "center" },
  { header: "Total", width: 130, align: "right", mono: true },
  { header: "Estado", width: 120 },
];

type Row = {
  punto_venta: number;
  numero: number;
  payment_date: string;
  total_amount: number | string;
  currency: string;
  status: string;
  suppliers: { legal_name: string } | null;
};

function statusLabel(status: string): string {
  return status === "canceled" ? "Anulada" : "Emitida";
}

export const paymentOrders: Exporter = {
  permission: "payment_orders:read",
  load: async (params: URLSearchParams, range: ExportRange) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("payment_orders")
        .select(
          "punto_venta, numero, payment_date, total_amount, currency, status, suppliers ( legal_name )",
        )
        .order("payment_date", { ascending: true })
        .order("numero", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("payment_date", range.from);
      if (range.to) query = query.lte("payment_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load payment orders.");

    const orders = (data ?? []) as unknown as Row[];

    // Sum only ARS amounts: mixing currencies into one total would be wrong.
    let totalArs = 0;
    const rows = orders.map((op) => {
      const amount = Number(op.total_amount);
      const currency = isPaymentOrderCurrency(op.currency)
        ? op.currency
        : "ARS";
      if (currency === "ARS") totalArs += amount;
      return [
        dateCell(op.payment_date),
        formatPaymentOrderNumber(op.punto_venta, op.numero),
        op.suppliers?.legal_name ?? "—",
        currency,
        moneyCell(amount, { currency, text: formatMoney(amount, currency) }),
        statusLabel(op.status),
      ];
    });

    return {
      title: "Órdenes de pago",
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "", "Total ARS", moneyCell(totalArs), ""],
      orientation: "landscape",
      fileName: "ordenes-de-pago",
    };
  },
};
