import "server-only";

import { formatArgentineDate, formatNumber2 } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 70, mono: true },
  { header: "Vehículo", width: 80, mono: true },
  { header: "Litros", width: 70, align: "right", mono: true },
  { header: "Importe", width: 95, align: "right", mono: true },
  { header: "Odómetro", width: 80, align: "right", mono: true },
  { header: "Estación", width: 152 },
];

type VehicleJoin = { patente: string };

export const fuel: Exporter = {
  permission: "fuel:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("fuel_loads")
        .select(
          "load_date, liters, amount, odometer_km, station, vehicles!inner(patente)",
        )
        .order("load_date", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("load_date", range.from);
      if (range.to) query = query.lte("load_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load fuel loads.");

    let total = 0;
    const rows = (data ?? []).map((row) => {
      const vehicle: VehicleJoin = row.vehicles;
      const amount = Number(row.amount);
      total += amount;
      return [
        formatArgentineDate(row.load_date),
        vehicle.patente,
        formatNumber2(Number(row.liters)),
        money(amount),
        row.odometer_km === null ? "—" : formatNumber2(Number(row.odometer_km)),
        row.station ?? "—",
      ];
    });

    return {
      title: "Cargas de combustible",
      columns: COLUMNS,
      rows,
      totalsRow: ["", "", "", money(total), "", ""],
      fileName: "cargas-combustible",
    };
  },
};
