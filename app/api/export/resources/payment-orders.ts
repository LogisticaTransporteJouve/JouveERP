import "server-only";

import { createClient } from "@/lib/supabase/server";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import {
  formatPaymentOrderNumber,
  isPaymentOrderCurrency,
} from "@/features/payment-orders/schema";

import {
  money,
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

    let query = supabase
      .from("payment_orders")
      .select(
        "punto_venta, numero, payment_date, total_amount, currency, status, suppliers ( legal_name )",
      )
      .order("payment_date", { ascending: true })
      .order("numero", { ascending: true });

    if (range.from) query = query.gte("payment_date", range.from);
    if (range.to) query = query.lte("payment_date", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar las órdenes de pago.");

    const orders = (data ?? []) as unknown as Row[];

    // Sum only ARS amounts: mixing currencies into one total would be wrong.
    let totalArs = 0;
    const rows = orders.map((op) => {
      const amount = Number(op.total_amount);
      const currency = isPaymentOrderCurrency(op.currency) ? op.currency : "ARS";
      if (currency === "ARS") totalArs += amount;
      return [
        formatArgentineDate(op.payment_date),
        formatPaymentOrderNumber(op.punto_venta, op.numero),
        op.suppliers?.legal_name ?? "—",
        currency,
        formatMoney(amount, currency),
        statusLabel(op.status),
      ];
    });

    return {
      title: "Órdenes de pago",
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "", "Total ARS", money(totalArs), ""],
      orientation: "landscape",
      fileName: "ordenes-de-pago",
    };
  },
};
