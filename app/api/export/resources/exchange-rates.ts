import "server-only";

import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
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

    let query = supabase
      .from("exchange_rates")
      .select("rate_date, rate, source, notes")
      .order("rate_date", { ascending: true });

    if (range.from) query = query.gte("rate_date", range.from);
    if (range.to) query = query.lte("rate_date", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar las cotizaciones.");

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
