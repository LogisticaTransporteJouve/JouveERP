import "server-only";

import { ACCOUNT_TYPE_LABEL, isAccountType } from "@/features/accounts/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import type { Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Nombre", width: 247 },
  { header: "Tipo", width: 150 },
  { header: "Moneda", width: 70, mono: true },
  { header: "Estado", width: 80 },
];

function accountTypeLabel(type: string): string {
  return isAccountType(type) ? ACCOUNT_TYPE_LABEL[type] : type;
}

export const accounts: Exporter = {
  permission: "accounts:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("accounts")
        .select("name, type, currency, is_active, created_at")
        .order("name", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("created_at", range.from);
      if (range.to) query = query.lte("created_at", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load accounts.");

    const rows = (data ?? []).map((row) => [
      row.name,
      accountTypeLabel(row.type),
      row.currency,
      row.is_active ? "Activa" : "Inactiva",
    ]);

    return {
      title: "Cuentas de caja",
      columns: COLUMNS,
      rows,
      fileName: "cuentas",
    };
  },
};
