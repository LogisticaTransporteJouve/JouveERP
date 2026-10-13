import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database";
import { paginateRange, type DrainResult } from "@/lib/supabase/paginate";

import type { LibroIvaComprasRow, LibroIvaVentasRow } from "../schema";

type Db = SupabaseClient<Database>;

// The libro IVA RPCs return one row per (comprobante, alícuota). A month with a
// few hundred multi-rate invoices already exceeds PostgREST's max_rows (1000),
// and the response is silently truncated — so both books are drained page by
// page. Each page re-orders the RPC result with a TOTAL order (the RPC's own
// ORDER BY ties on numero across puntos de venta), keeping the RPC's display
// order: date → type → number, then the document id + alícuota as tie-breakers.

/** Libro IVA Ventas rows for a period (all fiscal channels when channelId is null). */
export async function fetchLibroIvaVentasRows(
  supabase: Db,
  period: string,
  channelId: string | null,
): Promise<DrainResult<LibroIvaVentasRow>> {
  return paginateRange((from, to) =>
    supabase
      .rpc("libro_iva_ventas", {
        p_period: period,
        p_channel_id: channelId ?? undefined,
      })
      .order("fecha", { ascending: true })
      .order("cbte_tipo_afip", { ascending: true })
      .order("numero", { ascending: true })
      .order("invoice_id", { ascending: true })
      .order("iva_rate_id", { ascending: true, nullsFirst: false })
      .range(from, to),
  );
}

/** Libro IVA Compras rows for a period (all fiscal channels when channelId is null). */
export async function fetchLibroIvaComprasRows(
  supabase: Db,
  period: string,
  channelId: string | null,
): Promise<DrainResult<LibroIvaComprasRow>> {
  return paginateRange((from, to) =>
    supabase
      .rpc("libro_iva_compras", {
        p_period: period,
        p_channel_id: channelId ?? undefined,
      })
      .order("fecha", { ascending: true })
      .order("letter", { ascending: true, nullsFirst: false })
      .order("numero", { ascending: true })
      .order("purchase_invoice_id", { ascending: true })
      .order("iva_rate_id", { ascending: true, nullsFirst: false })
      .range(from, to),
  );
}
