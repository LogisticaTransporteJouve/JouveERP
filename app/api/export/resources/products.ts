import "server-only";

import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Cliente", width: 130 },
  { header: "Producto", width: 150 },
  { header: "SKU", width: 90, mono: true },
  { header: "Unidad", width: 70 },
  { header: "Estado", width: 60 },
  { header: "Alta", width: 60, mono: true },
];

type ClientJoin = { legal_name: string };

export const products: Exporter = {
  permission: "products:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("products")
      .select(
        "name, sku, unit, is_active, created_at, clients!inner(legal_name)",
      )
      .order("created_at", { ascending: true });

    // created_at is a timestamptz; bound the upper end to the full day so
    // same-day rows aren't dropped by the date-only range value.
    if (range.from) query = query.gte("created_at", range.from);
    if (range.to) query = query.lte("created_at", `${range.to}T23:59:59.999`);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar los productos.");

    const rows = (data ?? []).map((row) => {
      const client: ClientJoin = row.clients;
      return [
        client.legal_name,
        row.name,
        row.sku ?? "—",
        row.unit ?? "—",
        row.is_active ? "Activo" : "Inactivo",
        formatArgentineDate(row.created_at),
      ];
    });

    return {
      title: "Productos",
      subtitle: "Catálogo de productos por cliente.",
      columns: COLUMNS,
      rows,
      fileName: "productos",
    };
  },
};
