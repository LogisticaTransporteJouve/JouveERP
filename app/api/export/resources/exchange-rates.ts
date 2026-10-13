import "server-only";

import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { type Exporter } from "../shared";

// Portrait A4 ≈ 547pt: Fecha, ARS por USD, Fuente, Notas.
const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 80, mono: true },
  { header: "ARS por USD", width: 110, align: "right", mono: true },
  { header: "Fuente", width: 70 },
  { header: "Notas", width: 287 },
];

// Mirrors the on-screen rate format (2–6 decimals, es-AR).
const rateFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export const exchangeRates: Exporter = {
  permission: "accounting:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("exchange_rates")
        .select("rate_date, rate, source, notes")
        .order("rate_date", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("rate_date", range.from);
      if (range.to) query = query.lte("rate_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load exchange rates.");

    const rows = (data ?? []).map((r) => [
      formatArgentineDate(r.rate_date),
      rateFmt.format(Number(r.rate)),
      r.source === "manual" ? "Manual" : "BCRA",
      r.notes ?? "—",
    ]);

    return {
      title: "Cotización USD",
      subtitle: "Referencia oficial BCRA (ARS por 1 USD)",
      columns: COLUMNS,
      rows,
      fileName: "cotizaciones-usd",
    };
  },
};
