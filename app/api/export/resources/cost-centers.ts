import "server-only";

import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import type { Exporter } from "../shared";

// Portrait A4 ≈ 547pt: Código, Nombre, Descripción, Estado.
const COLUMNS: TableReportColumn[] = [
  { header: "Código", width: 90, mono: true },
  { header: "Nombre", width: 150 },
  { header: "Descripción", width: 247 },
  { header: "Estado", width: 60 },
];

export const costCenters: Exporter = {
  permission: "accounting:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("cost_centers")
        .select("code, name, description, is_active, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      // created_at is a timestamptz; bound the upper end to the full day so
      // rows created on `range.to` are not excluded.
      if (range.from) query = query.gte("created_at", range.from);
      if (range.to) query = query.lte("created_at", `${range.to}T23:59:59.999`);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load cost centers.");

    const rows = (data ?? []).map((cc) => [
      cc.code,
      cc.name,
      cc.description ?? "—",
      cc.is_active ? "Activo" : "Inactivo",
    ]);

    return {
      title: "Centros de costo",
      columns: COLUMNS,
      rows,
      fileName: "centros-de-costo",
    };
  },
};
