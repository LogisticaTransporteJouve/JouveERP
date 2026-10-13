import "server-only";

import { VEHICLE_TYPE_LABELS, isVehicleType } from "@/features/vehicles/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Patente", width: 90, mono: true },
  { header: "Marca/Modelo", width: 180 },
  { header: "Año", width: 50, align: "right", mono: true },
  { header: "Tipo", width: 100 },
  { header: "Estado", width: 127 },
];

export const vehicles: Exporter = {
  permission: "vehicles:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("vehicles")
        .select(
          "patente, brand, model, year, vehicle_type, is_active, created_at",
        )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("created_at", range.from);
      if (range.to) query = query.lte("created_at", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load vehicles.");

    const rows = (data ?? []).map((row) => {
      const brandModel = [row.brand, row.model].filter(Boolean).join(" ") || "—";
      const type = isVehicleType(row.vehicle_type)
        ? VEHICLE_TYPE_LABELS[row.vehicle_type]
        : row.vehicle_type;
      return [
        row.patente,
        brandModel,
        row.year != null ? String(row.year) : "—",
        type,
        row.is_active ? "Activo" : "Inactivo",
      ];
    });

    return {
      title: "Vehículos",
      columns: COLUMNS,
      rows,
      fileName: "vehiculos",
    };
  },
};
