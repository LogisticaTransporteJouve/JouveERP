import "server-only";

import {
  CHECK_KIND_LABEL,
  CHECK_STATUS_LABEL,
  isChequeKind,
  isChequeStatus,
} from "@/features/checks/schema";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

import {
  channelCell,
  dateCell,
  exportScope,
  inRange,
  moneyCell,
  scopedSubtitle,
  totalCell,
  type Exporter,
} from "../shared";

// Landscape A4 ≈ 794pt: Tipo, Número, Banco, Firmante, Canal, Vencimiento,
// Monto, Estado.
const CHECK_COLUMNS: TableReportColumn[] = [
  { header: "Tipo", width: 60 },
  { header: "Número", width: 90, mono: true },
  { header: "Banco", width: 110 },
  { header: "Firmante", width: 120 },
  { header: "Canal", width: 90 },
  { header: "Vencimiento", width: 84, mono: true },
  { header: "Monto", width: 120, align: "right", mono: true },
  { header: "Estado", width: 90 },
];

export const checks: Exporter = {
  permission: "cheques:read",
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const supabase = await createClient();
    // Drained page by page (PostgREST max_rows = 1000), range pushed to SQL.
    const { data, error } = await paginateRange((from, to) => {
      let query = applyFiscalFilter(
        supabase
          .from("checks")
          .select(
            "kind, check_number, bank_name, drawer_name, due_date, amount, currency, status, channel:invoicing_channels(name, is_fiscal)",
          ),
        isFiscal,
        "channel",
      )
        .order("due_date", { ascending: true })
        .order("id", { ascending: true });
      if (range.from) query = query.gte("due_date", range.from);
      if (range.to) query = query.lte("due_date", range.to);
      return query.range(from, to);
    });

    if (error) throw new Error("Could not load checks.");

    const filtered = (data ?? []).filter((c) => inRange(c.due_date, range));

    let total = 0;
    const currencies = new Set<string>();
    const rows = filtered.map((c) => {
      const amount = Number(c.amount);
      total += amount;
      currencies.add(c.currency);
      const kindLabel = isChequeKind(c.kind)
        ? CHECK_KIND_LABEL[c.kind]
        : c.kind;
      const statusLabel = isChequeStatus(c.status)
        ? CHECK_STATUS_LABEL[c.status]
        : c.status;
      return [
        kindLabel,
        c.check_number,
        c.bank_name,
        c.drawer_name,
        channelCell(c.channel),
        dateCell(c.due_date),
        moneyCell(amount, { currency: c.currency }),
        statusLabel,
      ];
    });

    return {
      title: "Cheques en cartera",
      subtitle: scopedSubtitle(scope),
      columns: CHECK_COLUMNS,
      rows,
      totalsRow: [
        "",
        "",
        "",
        "",
        "",
        "Total",
        totalCell(total, currencies),
        "",
      ],
      orientation: "landscape",
      fileName: "cheques",
    };
  },
};
