import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

import {
  detectAnomalies,
  type AnomalyFinding,
  type PurchaseRow,
} from "./detect";

const LOOKBACK_DAYS = 365;

function readName(
  supplier: { legal_name: string } | { legal_name: string }[] | null,
): string {
  const s = Array.isArray(supplier) ? supplier[0] : supplier;
  return s?.legal_name ?? "—";
}

function minus(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Reads the last year of supplier invoices and runs the deterministic detectors. */
export async function gatherAnomalies(today: string): Promise<AnomalyFinding[]> {
  const service = getServiceClient();
  const { data } = await service
    .from("purchase_invoices")
    .select(
      "id, supplier_id, imp_total, fecha, numero, punto_venta, supplier:suppliers(legal_name)",
    )
    .eq("kind", "factura")
    .gte("fecha", minus(LOOKBACK_DAYS, today));

  const rows: PurchaseRow[] = (data ?? []).map((r) => ({
    id: r.id,
    supplier_id: r.supplier_id,
    supplier_name: readName(r.supplier),
    imp_total: Number(r.imp_total),
    fecha: r.fecha,
    numero: r.numero,
    punto_venta: r.punto_venta,
  }));

  return detectAnomalies(rows);
}
