import "server-only";

import { FLEET_DOC_KIND_LABELS, isFleetDocKind } from "@/features/fleet-documents/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Tipo", width: 130 },
  { header: "Vehículo / Chofer", width: 197 },
  { header: "Número", width: 110, mono: true },
  { header: "Vencimiento", width: 110, mono: true },
];

type VehicleJoin = { patente: string } | null;
type DriverJoin = { full_name: string } | null;

export const fleetDocuments: Exporter = {
  permission: "fleet_documents:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("fleet_documents")
      .select(
        "kind, number, expires_at, created_at, vehicle:vehicles(patente), driver:drivers(full_name)",
      )
      .order("expires_at", { ascending: true });

    if (range.from) query = query.gte("created_at", range.from);
    if (range.to) query = query.lte("created_at", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudo cargar la documentación de flota.");

    const rows = (data ?? []).map((row) => {
      const vehicle: VehicleJoin = row.vehicle;
      const driver: DriverJoin = row.driver;
      const owner = vehicle?.patente ?? driver?.full_name ?? "—";
      const kindLabel = isFleetDocKind(row.kind)
        ? FLEET_DOC_KIND_LABELS[row.kind]
        : row.kind;
      return [
        kindLabel,
        owner,
        row.number ?? "—",
        formatArgentineDate(row.expires_at),
      ];
    });

    return {
      title: "Documentación de flota",
      subtitle: "Vencimientos de vehículos y choferes",
      columns: COLUMNS,
      rows,
      fileName: "documentacion-flota",
    };
  },
};
