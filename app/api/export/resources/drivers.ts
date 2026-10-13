import "server-only";

import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import type { Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Nombre", width: 150 },
  { header: "CUIT", width: 95, mono: true },
  { header: "Licencia", width: 95 },
  { header: "Teléfono", width: 95, mono: true },
  { header: "Estado", width: 52 },
  { header: "Alta", width: 60, mono: true },
];

export const drivers: Exporter = {
  permission: "drivers:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("drivers")
        .select(
          "full_name, cuit, license_number, license_category, phone, is_active, created_at",
        )
        .order("full_name", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("created_at", range.from);
      if (range.to) query = query.lte("created_at", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load drivers.");

    const rows = (data ?? []).map((row) => {
      const license = row.license_number
        ? row.license_category
          ? `${row.license_number} (${row.license_category})`
          : row.license_number
        : "—";
      return [
        row.full_name,
        row.cuit ?? "—",
        license,
        row.phone ?? "—",
        row.is_active ? "Activo" : "Inactivo",
        formatArgentineDate(row.created_at),
      ];
    });

    return {
      title: "Choferes",
      columns: COLUMNS,
      rows,
      fileName: "choferes",
    };
  },
};
