import "server-only";

import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Nombre", width: 207 },
  { header: "Slug", width: 160, mono: true },
  { header: "Estado", width: 90 },
  { header: "Alta", width: 90, mono: true },
];

export const supplierCategories: Exporter = {
  permission: "suppliers:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("supplier_categories")
        .select("name, slug, is_active, created_at")
        .order("name", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("created_at", range.from);
      if (range.to) query = query.lte("created_at", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load categories.");

    const rows = (data ?? []).map((row) => [
      row.name,
      row.slug,
      row.is_active ? "Activa" : "Inactiva",
      formatArgentineDate(row.created_at),
    ]);

    return {
      title: "Categorías de proveedores",
      columns: COLUMNS,
      rows,
      fileName: "categorias-proveedores",
    };
  },
};
