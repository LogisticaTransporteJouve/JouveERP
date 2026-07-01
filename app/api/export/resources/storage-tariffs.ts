import "server-only";

import {
  TARIFF_PERIOD_LABELS,
  isTariffPeriod,
  type TariffPeriod,
} from "@/features/storage-tariffs/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

// Landscape A4 ≈ 794pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Cliente", width: 220 },
  { header: "Tarifa por pallet", width: 130, align: "right", mono: true },
  { header: "Período", width: 90 },
  { header: "Vigencia desde", width: 110, mono: true },
  { header: "Vigencia hasta", width: 110, mono: true },
  { header: "Estado", width: 80 },
];

type ClientJoin = { legal_name: string };

export const storageTariffs: Exporter = {
  permission: "storage_billing:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("storage_tariffs")
      .select(
        "rate_per_pallet, period, valid_from, valid_to, is_active, client:clients(legal_name)",
      )
      .order("valid_from", { ascending: true });

    if (range.from) query = query.gte("valid_from", range.from);
    if (range.to) query = query.lte("valid_from", range.to);

    const { data, error } = await query;
    if (error) throw new Error("Could not load tariffs.");

    const rows = (data ?? []).map((row) => {
      const client: ClientJoin | null = row.client;
      const period: TariffPeriod = isTariffPeriod(row.period)
        ? row.period
        : "monthly";
      return [
        client?.legal_name ?? "General",
        money(Number(row.rate_per_pallet)),
        TARIFF_PERIOD_LABELS[period],
        formatArgentineDate(row.valid_from),
        row.valid_to ? formatArgentineDate(row.valid_to) : "—",
        row.is_active ? "Activo" : "Inactivo",
      ];
    });

    return {
      title: "Tarifas de almacenaje",
      columns: COLUMNS,
      rows,
      orientation: "landscape",
      fileName: "tarifas-almacenaje",
    };
  },
};
