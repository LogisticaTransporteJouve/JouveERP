import "server-only";

import { IVA_CONDITION_LABEL } from "@/features/clients/schema";
import { isIvaCondition } from "@/features/clients/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Razón social", width: 160 },
  { header: "CUIT", width: 95, mono: true },
  { header: "Condición IVA", width: 120 },
  { header: "Categoría", width: 100 },
  { header: "Estado", width: 72 },
];

type CategoryJoin = { name: string } | null;

export const suppliers: Exporter = {
  permission: "suppliers:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("suppliers")
      .select(
        "legal_name, display_name, cuit, iva_condition, is_active, created_at, supplier_categories(name)",
      )
      .order("legal_name", { ascending: true });

    if (range.from) query = query.gte("created_at", range.from);
    if (range.to) query = query.lte("created_at", range.to);

    const { data, error } = await query;
    if (error) throw new Error("Could not load suppliers.");

    const rows = (data ?? []).map((row) => {
      const category: CategoryJoin = row.supplier_categories;
      const ivaLabel = isIvaCondition(row.iva_condition)
        ? IVA_CONDITION_LABEL[row.iva_condition]
        : row.iva_condition;
      const legalName = row.display_name
        ? `${row.legal_name} (${row.display_name})`
        : row.legal_name;
      return [
        legalName,
        row.cuit,
        ivaLabel,
        category?.name ?? "—",
        row.is_active ? "Activo" : "Inactivo",
      ];
    });

    return {
      title: "Proveedores",
      columns: COLUMNS,
      rows,
      fileName: "proveedores",
    };
  },
};
