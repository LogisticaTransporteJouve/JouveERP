import "server-only";

import {
  ACCOUNT_TYPE_LABEL,
  isAccountType,
} from "@/features/accounts/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
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

    let query = supabase
      .from("accounts")
      .select("name, type, currency, is_active, created_at")
      .order("name", { ascending: true });

    if (range.from) query = query.gte("created_at", range.from);
    if (range.to) query = query.lte("created_at", range.to);

    const { data, error } = await query;
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
