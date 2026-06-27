import "server-only";

import {
  CHECK_KIND_LABEL,
  CHECK_STATUS_LABEL,
  isChequeKind,
  isChequeStatus,
} from "@/features/checks/schema";
import { formatArgentineDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

import { inRange, money, type Exporter } from "../shared";

// Landscape A4 ≈ 794pt: Tipo, Número, Banco, Firmante, Vencimiento, Monto, Estado.
const CHECK_COLUMNS: TableReportColumn[] = [
  { header: "Tipo", width: 70 },
  { header: "Número", width: 100, mono: true },
  { header: "Banco", width: 150 },
  { header: "Firmante", width: 150 },
  { header: "Vencimiento", width: 84, mono: true },
  { header: "Monto", width: 120, align: "right", mono: true },
  { header: "Estado", width: 90 },
];

export const checks: Exporter = {
  permission: "cheques:read",
  load: async (_params, range) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("checks")
      .select(
        "kind, check_number, bank_name, drawer_name, due_date, amount, status",
      )
      .order("due_date", { ascending: true });

    if (error) throw new Error("No se pudieron cargar los cheques.");

    const filtered = (data ?? []).filter((c) => inRange(c.due_date, range));

    let total = 0;
    const rows = filtered.map((c) => {
      const amount = Number(c.amount);
      total += amount;
      const kindLabel = isChequeKind(c.kind) ? CHECK_KIND_LABEL[c.kind] : c.kind;
      const statusLabel = isChequeStatus(c.status)
        ? CHECK_STATUS_LABEL[c.status]
        : c.status;
      return [
        kindLabel,
        c.check_number,
        c.bank_name,
        c.drawer_name,
        formatArgentineDate(c.due_date),
        money(amount),
        statusLabel,
      ];
    });

    return {
      title: "Cheques en cartera",
      columns: CHECK_COLUMNS,
      rows,
      totalsRow: ["", "", "", "", "Total", money(total), ""],
      orientation: "landscape",
      fileName: "cheques",
    };
  },
};
