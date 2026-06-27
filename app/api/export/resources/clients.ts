import "server-only";

import { IVA_CONDITION_LABEL, isIvaCondition } from "@/features/clients/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import type { Exporter } from "../shared";

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
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("clients")
      .select("legal_name, display_name, cuit, iva_condition, is_active, created_at")
      .order("legal_name", { ascending: true });

    if (range.from) query = query.gte("created_at", range.from);
    if (range.to) query = query.lte("created_at", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar los clientes.");

    const rows = (data ?? []).map((row) => [
      row.legal_name,
      row.display_name ?? "—",
      row.cuit,
      isIvaCondition(row.iva_condition)
        ? IVA_CONDITION_LABEL[row.iva_condition]
        : row.iva_condition,
      row.is_active ? "Activo" : "Inactivo",
    ]);

    return {
      title: "Clientes",
      columns: COLUMNS,
      rows,
      fileName: "clientes",
    };
  },
};
