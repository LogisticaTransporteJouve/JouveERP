import "server-only";

import { ivaConditionLabel } from "@/features/clients/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { exportScope, scopedSubtitle, type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Razón social", width: 150 },
  { header: "Nombre fantasía", width: 130 },
  { header: "CUIT", width: 95, mono: true },
  { header: "Condición IVA", width: 110 },
  { header: "Estado", width: 62 },
];

export const clients: Exporter = {
  permission: "clients:read",
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("clients")
        .select(
          "legal_name, display_name, cuit, iva_condition, is_active, created_at",
        )
        .order("legal_name", { ascending: true })
        .order("id", { ascending: true });

      if (isFiscal !== null) query = query.eq("is_fiscal", isFiscal);
      if (range.from) query = query.gte("created_at", range.from);
      if (range.to) query = query.lte("created_at", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load clients.");

    const rows = (data ?? []).map((row) => [
      row.legal_name,
      row.display_name ?? "—",
      row.cuit ?? "—",
      ivaConditionLabel(row.iva_condition) ?? "—",
      row.is_active ? "Activo" : "Inactivo",
    ]);

    return {
      title: "Clientes",
      subtitle: scopedSubtitle(scope),
      columns: COLUMNS,
      rows,
      fileName: "clientes",
    };
  },
};
