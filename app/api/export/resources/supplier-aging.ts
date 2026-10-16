import "server-only";

import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

import { moneyCell, type Exporter } from "../shared";

// Landscape A4 ≈ 794pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Proveedor", width: 224 },
  { header: "CUIT", width: 110, mono: true },
  { header: "0–30", width: 92, align: "right", mono: true },
  { header: "30–60", width: 92, align: "right", mono: true },
  { header: "60–90", width: 92, align: "right", mono: true },
  { header: "90+", width: 92, align: "right", mono: true },
  { header: "Total", width: 92, align: "right", mono: true },
];

export const supplierAging: Exporter = {
  permission: "suppliers:read",
  // Snapshot: aging buckets reflect "today". The date range is ignored.
  load: async () => {
    const res = await getSupplierAgingAction();
    if (!res.ok) throw new Error(res.error);

    const suppliers = res.data
      .slice()
      .sort((a, b) => b.total_open - a.total_open);

    const totals = {
      bucket_0_30: 0,
      bucket_30_60: 0,
      bucket_60_90: 0,
      bucket_90_plus: 0,
      total_open: 0,
    };

    const rows = suppliers.map((s) => {
      totals.bucket_0_30 += s.bucket_0_30;
      totals.bucket_30_60 += s.bucket_30_60;
      totals.bucket_60_90 += s.bucket_60_90;
      totals.bucket_90_plus += s.bucket_90_plus;
      totals.total_open += s.total_open;
      return [
        s.supplier_legal_name,
        s.supplier_cuit,
        moneyCell(s.bucket_0_30),
        moneyCell(s.bucket_30_60),
        moneyCell(s.bucket_60_90),
        moneyCell(s.bucket_90_plus),
        moneyCell(s.total_open),
      ];
    });

    return {
      title: "Aging de proveedores",
      subtitle: "Deudas con proveedores por antigüedad",
      columns: COLUMNS,
      rows,
      totalsRow: [
        "Totales",
        "",
        moneyCell(totals.bucket_0_30),
        moneyCell(totals.bucket_30_60),
        moneyCell(totals.bucket_60_90),
        moneyCell(totals.bucket_90_plus),
        moneyCell(totals.total_open),
      ],
      orientation: "landscape",
      fileName: "aging-proveedores",
    };
  },
};
