import "server-only";

import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import type { Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Apellido y nombre", width: 190 },
  { header: "CUIL", width: 100, mono: true },
  { header: "Puesto", width: 110 },
  { header: "Estado", width: 67 },
  { header: "Ingreso", width: 80, mono: true },
];

export const employees: Exporter = {
  permission: "hr:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("employees")
      .select("legal_name, cuil, position, is_active, hire_date, created_at")
      .order("legal_name", { ascending: true });

    if (range.from) query = query.gte("created_at", range.from);
    if (range.to) query = query.lte("created_at", range.to);

    const { data, error } = await query;
    if (error) throw new Error("Could not load employees.");

    const rows = (data ?? []).map((row) => [
      row.legal_name,
      row.cuil ?? "—",
      row.position ?? "—",
      row.is_active ? "Activo" : "Inactivo",
      formatArgentineDate(row.hire_date),
    ]);

    return {
      title: "Empleados",
      columns: COLUMNS,
      rows,
      fileName: "empleados",
    };
  },
};
