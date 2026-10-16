import "server-only";

import {
  MAINTENANCE_KIND_LABELS,
  isMaintenanceKind,
} from "@/features/maintenance/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { dateCell, moneyCell, type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 80, mono: true },
  { header: "Vehículo", width: 90, mono: true },
  { header: "Tipo", width: 100 },
  { header: "Costo", width: 120, align: "right", mono: true },
  { header: "Próx. service", width: 90, mono: true },
];

type VehicleJoin = { patente: string };

export const maintenance: Exporter = {
  permission: "maintenance:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("maintenance_records")
        .select(
          "service_date, kind, cost, next_service_date, vehicle:vehicles!inner(patente)",
        )
        .order("service_date", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("service_date", range.from);
      if (range.to) query = query.lte("service_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load maintenance records.");

    let total = 0;
    const rows = (data ?? []).map((row) => {
      const vehicle: VehicleJoin = row.vehicle;
      const cost = row.cost === null ? null : Number(row.cost);
      if (cost !== null) total += cost;
      const kindLabel = isMaintenanceKind(row.kind)
        ? MAINTENANCE_KIND_LABELS[row.kind]
        : row.kind;
      return [
        dateCell(row.service_date),
        vehicle.patente,
        kindLabel,
        cost === null ? "—" : moneyCell(cost),
        dateCell(row.next_service_date),
      ];
    });

    return {
      title: "Mantenimientos",
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "Total", moneyCell(total), ""],
      fileName: "mantenimientos",
    };
  },
};
