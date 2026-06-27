import "server-only";

import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Nombre", width: 170 },
  { header: "Dirección", width: 220 },
  { header: "Capacidad (pallets)", width: 90, align: "right", mono: true },
  { header: "Estado", width: 67 },
];

export const warehouses: Exporter = {
  permission: "warehouses:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("warehouses")
      .select("name, address, capacity_pallets, is_active, created_at")
      .order("name", { ascending: true });

    if (range.from) query = query.gte("created_at", range.from);
    // created_at is a timestamp; extend the upper bound to the end of the day
    // so rows created on `range.to` are included.
    if (range.to) query = query.lte("created_at", `${range.to}T23:59:59.999`);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar los depósitos.");

    const rows = (data ?? []).map((row) => [
      row.name,
      row.address ?? "—",
      row.capacity_pallets === null ? "—" : String(row.capacity_pallets),
      row.is_active ? "Activo" : "Inactivo",
    ]);

    return {
      title: "Depósitos",
      columns: COLUMNS,
      rows,
      fileName: "depositos",
    };
  },
};
