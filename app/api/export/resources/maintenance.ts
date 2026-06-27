import "server-only";

import {
  MAINTENANCE_KIND_LABELS,
  isMaintenanceKind,
} from "@/features/maintenance/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

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

    let query = supabase
      .from("maintenance_records")
      .select(
        "service_date, kind, cost, next_service_date, vehicle:vehicles!inner(patente)",
      )
      .order("service_date", { ascending: true });

    if (range.from) query = query.gte("service_date", range.from);
    if (range.to) query = query.lte("service_date", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar los mantenimientos.");

    let total = 0;
    const rows = (data ?? []).map((row) => {
      const vehicle: VehicleJoin = row.vehicle;
      const cost = row.cost === null ? null : Number(row.cost);
      if (cost !== null) total += cost;
      const kindLabel = isMaintenanceKind(row.kind)
        ? MAINTENANCE_KIND_LABELS[row.kind]
        : row.kind;
      return [
        formatArgentineDate(row.service_date),
        vehicle.patente,
        kindLabel,
        cost === null ? "—" : money(cost),
        formatArgentineDate(row.next_service_date),
      ];
    });

    return {
      title: "Mantenimientos",
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "Total", money(total), ""],
      fileName: "mantenimientos",
    };
  },
};
