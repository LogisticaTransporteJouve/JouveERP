import "server-only";

import { ivaConditionLabel } from "@/features/clients/schema";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  endOfDay,
  exportChannelScope,
  exportScope,
  scopedSubtitle,
  type Exporter,
} from "../shared";

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
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const channelScope = await exportChannelScope(params, isFiscal);
    const supabase = await createClient();

    // Inside a segregated channel's section, its suppliers (the section's
    // list: search_suppliers members-only); elsewhere, the main app's.
    let memberIds: string[] | null = null;
    if (channelScope.channelId) {
      const members = await paginateRange(
        (from, to) =>
          supabase
            .rpc("search_suppliers", {
              p_query: "",
              p_only_active: false,
              p_offset: from,
              p_limit: to - from + 1,
              p_is_fiscal: channelScope.isFiscal ?? undefined,
              p_channel_id: channelScope.channelId ?? undefined,
              p_channel_members_only: true,
            })
            .select("id"),
        200,
      );
      if (members.error) throw new Error("Could not load suppliers.");
      memberIds = (members.data ?? []).map((m) => m.id);
    }

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("suppliers")
        .select(
          "legal_name, display_name, cuit, iva_condition, is_active, created_at, supplier_categories(name)",
        )
        .order("legal_name", { ascending: true })
        .order("id", { ascending: true });

      if (channelScope.isFiscal !== null) {
        query = query.eq("is_fiscal", channelScope.isFiscal);
      }
      query = memberIds
        ? query.in("id", memberIds)
        : query.eq("in_main_scope", true);
      if (range.from) query = query.gte("created_at", range.from);
      if (range.to) query = query.lte("created_at", endOfDay(range.to));
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load suppliers.");

    const rows = (data ?? []).map((row) => {
      const category: CategoryJoin = row.supplier_categories;
      const ivaLabel = ivaConditionLabel(row.iva_condition) ?? "—";
      const legalName = row.display_name
        ? `${row.legal_name} (${row.display_name})`
        : row.legal_name;
      return [
        legalName,
        row.cuit ?? "—",
        ivaLabel,
        category?.name ?? "—",
        row.is_active ? "Activo" : "Inactivo",
      ];
    });

    return {
      title: "Proveedores",
      subtitle: scopedSubtitle(scope),
      columns: COLUMNS,
      rows,
      fileName: "proveedores",
    };
  },
};
