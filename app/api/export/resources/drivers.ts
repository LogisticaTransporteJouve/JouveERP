import "server-only";

import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
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

    let query = supabase
      .from("drivers")
      .select(
        "full_name, cuit, license_number, license_category, phone, is_active, created_at",
      )
      .order("full_name", { ascending: true });

    if (range.from) query = query.gte("created_at", range.from);
    if (range.to) query = query.lte("created_at", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar los choferes.");

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
