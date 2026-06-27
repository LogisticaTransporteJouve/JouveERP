import "server-only";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

import { money, type Exporter } from "../shared";

// Landscape A4 ≈ 794pt of usable width. Snapshot: ignores the date range.
const COLUMNS: TableReportColumn[] = [
  { header: "Cliente", width: 224 },
  { header: "CUIT", width: 100, mono: true },
  { header: "0–30 días", width: 90, align: "right", mono: true },
  { header: "30–60", width: 84, align: "right", mono: true },
  { header: "60–90", width: 84, align: "right", mono: true },
  { header: "90+", width: 84, align: "right", mono: true },
  { header: "Total", width: 128, align: "right", mono: true },
];

export const aging: Exporter = {
  permission: "clients:read",
  load: async () => {
    const res = await getAgingSummaryAction();
    if (!res.ok) throw new Error(res.error);
    const { clients, totals } = res.data;

    const rows = clients.map((c) => [
      c.legal_name,
      c.cuit,
      money(c.bucket_0_30),
      money(c.bucket_30_60),
      money(c.bucket_60_90),
      money(c.bucket_90_plus),
      money(c.total_open),
    ]);

    return {
      title: "Aging de clientes",
      subtitle: "Saldos pendientes por antigüedad",
      columns: COLUMNS,
      rows,
      totalsRow: [
        "Totales",
        "",
        money(totals.bucket_0_30),
        money(totals.bucket_30_60),
        money(totals.bucket_60_90),
        money(totals.bucket_90_plus),
        money(totals.total_open),
      ],
      orientation: "landscape",
      fileName: "aging-clientes",
    };
  },
};
