import "server-only";

import { paymentCurrencyOf } from "@/lib/fx";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { must } from "../gather";
import {
  detectAnomalies,
  purchaseScope,
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

function readIsFiscal(
  channel: { is_fiscal: boolean } | { is_fiscal: boolean }[] | null,
): boolean | null {
  const c = Array.isArray(channel) ? channel[0] : channel;
  return c?.is_fiscal ?? null;
}

function minus(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Reads the whole last year of received supplier invoices (a draft or
 *  cancelled one is not a charge) and runs the deterministic detectors per
 *  scope and currency. A failed read throws: the analyst keeps the previous
 *  cards of these kinds instead of deleting them. */
export async function gatherAnomalies(
  today: string,
): Promise<AnomalyFinding[]> {
  const service = getServiceClient();
  const data = must(
    await paginateRange((from, to) =>
      service
        .from("purchase_invoices")
        .select(
          "id, supplier_id, imp_total, moneda, fecha, numero, punto_venta, supplier:suppliers(legal_name), channel:invoicing_channels(is_fiscal)",
        )
        .eq("kind", "factura")
        .eq("status", "received")
        .gte("fecha", minus(LOOKBACK_DAYS, today))
        .order("id", { ascending: true })
        .range(from, to),
    ),
    "anomalies.purchase_invoices",
  );

  const rows: PurchaseRow[] = data.map((r) => ({
    id: r.id,
    scope: purchaseScope(readIsFiscal(r.channel)),
    supplier_id: r.supplier_id,
    supplier_name: readName(r.supplier),
    imp_total: Number(r.imp_total),
    currency: paymentCurrencyOf(r.moneda),
    fecha: r.fecha,
    numero: r.numero,
    punto_venta: r.punto_venta,
  }));

  return detectAnomalies(rows);
}
