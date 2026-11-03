import "server-only";

import {
  PALLET_STATUS_LABELS,
  isPalletStatus,
} from "@/features/pallets/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { dateCell, type Exporter } from "../shared";

// Landscape A4 ≈ 794pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Código", width: 90, mono: true },
  { header: "Depósito", width: 100 },
  { header: "Área", width: 80 },
  { header: "Cliente", width: 130 },
  { header: "Producto", width: 110 },
  { header: "Lote", width: 80 },
  { header: "Cantidad", width: 54, align: "right", mono: true },
  { header: "Estado", width: 70 },
  { header: "Ingreso", width: 80, mono: true },
];

type WarehouseJoin = { name: string };
type ClientJoin = { legal_name: string };
type ProductJoin = { name: string } | null;

export const pallets: Exporter = {
  permission: "pallets:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = supabase
        .from("pallets")
        .select(
          "code, quantity, status, entry_date, lot_number, lot_expiry, warehouse:warehouses!inner(name), client:clients!inner(legal_name), product:products(name), area:storage_areas(name)",
        )
        .order("entry_date", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("entry_date", range.from);
      if (range.to) query = query.lte("entry_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not load pallets.");

    const rows = (data ?? []).map((row) => {
      const warehouse: WarehouseJoin = row.warehouse;
      const client: ClientJoin = row.client;
      const product: ProductJoin = row.product;
      const status = isPalletStatus(row.status) ? row.status : "en_deposito";
      const quantity =
        row.quantity === null ? "—" : String(Number(row.quantity));
      const lot = row.lot_number
        ? row.lot_expiry
          ? `${row.lot_number} (vence ${formatArgentineDate(row.lot_expiry)})`
          : row.lot_number
        : "—";
      return [
        row.code,
        warehouse.name,
        row.area?.name ?? "—",
        client.legal_name,
        product?.name ?? "—",
        lot,
        quantity,
        PALLET_STATUS_LABELS[status],
        dateCell(row.entry_date),
      ];
    });

    return {
      title: "Pallets",
      columns: COLUMNS,
      rows,
      orientation: "landscape",
      fileName: "pallets",
    };
  },
};
