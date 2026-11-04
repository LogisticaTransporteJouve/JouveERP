import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { round2 } from "@/lib/format";

import { PURCHASE_TRIBUTE_FIELDS } from "@/features/purchase-invoices/schema";

// A suggested split of a purchase's "otros tributos" when the source (ARCA
// Mis Comprobantes, a scanned document) gives only the total. Never saved on
// its own: it fills the form the user confirms.

export type PurchaseTributeField = (typeof PURCHASE_TRIBUTE_FIELDS)[number];
export type TributeSplit = Partial<Record<PurchaseTributeField, number>>;

/** The supplier's latest fiscal purchase with tributes: its neto gravado and
 *  how its tributes were split. */
export type TributeHistory = {
  imp_neto: number;
  split: Record<PurchaseTributeField, number>;
};

export type TributeSuggestion = {
  split: TributeSplit;
  /** history: the supplier's last split on this neto; iva_rate: all of it
   *  matches an IVA perception rate; iva_and_iibb: an IVA perception at one
   *  of those rates plus IIBB; iibb: neither. */
  basis: "history" | "iva_rate" | "iva_and_iibb" | "iibb";
};

/** IVA perception rates on the neto gravado (RG 2408 regime). */
export const IVA_PERCEPTION_RATES = [0.015, 0.03] as const;

/** How far an amount may be from its rate on the neto: rounding. */
const RATE_TOLERANCE = 0.02;

/** IIBB perception rates a split may leave (the legacy data shows 1.75 % and
 *  2.5 %). A remainder outside [MIN, MAX] is not taken as IIBB next to an IVA
 *  perception; the habitual band breaks a tie between the two IVA rates. */
const IIBB_RATE_MIN = 0.005;
const IIBB_RATE_MAX = 0.05;
const IIBB_HABITUAL = [0.0175, 0.025] as const;

export const TRIBUTE_SUGGESTION_NOTE: Record<
  TributeSuggestion["basis"],
  string
> = {
  history:
    "Otros tributos: reparto sugerido según la última compra de este proveedor. Revisalo antes de guardar.",
  iva_rate:
    "Otros tributos: sugerimos percepción de IVA (coincide con 1,5 % o 3 % del neto gravado). Revisalo antes de guardar.",
  iva_and_iibb:
    "Otros tributos: sugerimos una percepción de IVA (1,5 % o 3 % del neto gravado) y el resto como IIBB. Revisalo antes de guardar.",
  iibb: "Otros tributos: sugerimos percepción de IIBB. Revisalo antes de guardar.",
};

function fromHistory(
  trib: number,
  neto: number,
  history: TributeHistory,
): TributeSplit | null {
  if (!(history.imp_neto > 0) || !(neto > 0)) return null;
  const parts = PURCHASE_TRIBUTE_FIELDS.map(
    (f) => [f, round2((history.split[f] / history.imp_neto) * neto)] as const,
  ).filter(([, v]) => v > 0);
  if (parts.length === 0) return null;
  const sum = round2(parts.reduce((a, [, v]) => a + v, 0));
  // The same rates on this neto have to give this total, or it is another
  // pattern and the history does not apply.
  if (Math.abs(sum - trib) > Math.max(RATE_TOLERANCE, trib * 0.001)) {
    return null;
  }
  const largest = parts.reduce((best, p) => (p[1] > best[1] ? p : best));
  const split: TributeSplit = Object.fromEntries(parts);
  split[largest[0]] = round2(largest[1] + trib - sum);
  return split;
}

function bandDistance(rate: number): number {
  const [low, high] = IIBB_HABITUAL;
  return rate < low ? low - rate : rate > high ? rate - high : 0;
}

/**
 * In order: the supplier's last split on this neto; all IVA perception when
 * the total is 1.5 % or 3 % of the neto gravado (±0.02); an IVA perception at
 * one of those rates plus a plausible IIBB remainder; else all IIBB. The parts
 * always add up to `trib`. `ivaComputable`: a letter A voucher, the only one
 * that carries IVA perceptions. Null when there is nothing to split.
 */
export function suggestTributeSplit(input: {
  trib: number;
  netoGravado: number;
  ivaComputable: boolean;
  history: TributeHistory | null;
}): TributeSuggestion | null {
  const trib = round2(input.trib);
  if (!(trib > 0)) return null;
  const neto = input.netoGravado;

  if (input.history) {
    const split = fromHistory(trib, neto, input.history);
    if (split) return { split, basis: "history" };
  }

  if (input.ivaComputable && neto > 0) {
    for (const rate of IVA_PERCEPTION_RATES) {
      if (Math.abs(trib - round2(neto * rate)) <= RATE_TOLERANCE) {
        return { split: { imp_perc_iva: trib }, basis: "iva_rate" };
      }
    }
    const candidates = IVA_PERCEPTION_RATES.map((rate) => {
      const iva = round2(neto * rate);
      const rest = round2(trib - iva);
      return { iva, rest, rate: rest / neto };
    }).filter(
      (c) => c.rest > 0 && c.rate >= IIBB_RATE_MIN && c.rate <= IIBB_RATE_MAX,
    );
    if (candidates.length > 0) {
      const best = candidates.reduce((a, c) =>
        bandDistance(c.rate) < bandDistance(a.rate) ? c : a,
      );
      return {
        split: { imp_perc_iva: best.iva, imp_perc_iibb: best.rest },
        basis: "iva_and_iibb",
      };
    }
  }

  return { split: { imp_perc_iibb: trib }, basis: "iibb" };
}

type Supabase = SupabaseClient<Database>;

/** Rows read to find each supplier's latest split: a page of the tray holds
 *  few suppliers, and an older purchase is a weaker hint anyway. */
const HISTORY_SCAN_LIMIT = 500;

/**
 * Each supplier's latest received fiscal factura with tributes and a neto,
 * by supplier id. A failed read returns null: the caller suggests without
 * history rather than failing the screen.
 */
export async function latestTributeSplits(
  supabase: Supabase,
  supplierIds: readonly string[],
): Promise<Map<string, TributeHistory> | null> {
  const out = new Map<string, TributeHistory>();
  const ids = [...new Set(supplierIds)];
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("purchase_invoices")
    .select(
      "supplier_id, imp_neto, imp_perc_iva, imp_perc_nacionales, imp_perc_iibb, imp_perc_municipales, imp_impuestos_internos, invoicing_channels!inner(is_fiscal)",
    )
    .in("supplier_id", ids)
    .eq("status", "received")
    .eq("kind", "factura")
    .eq("invoicing_channels.is_fiscal", true)
    .gt("imp_trib", 0)
    .gt("imp_neto", 0)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(HISTORY_SCAN_LIMIT);
  if (error) return null;
  for (const row of data ?? []) {
    if (out.has(row.supplier_id)) continue;
    out.set(row.supplier_id, {
      imp_neto: row.imp_neto,
      split: {
        imp_perc_iva: row.imp_perc_iva,
        imp_perc_nacionales: row.imp_perc_nacionales,
        imp_perc_iibb: row.imp_perc_iibb,
        imp_perc_municipales: row.imp_perc_municipales,
        imp_impuestos_internos: row.imp_impuestos_internos,
      },
    });
  }
  return out;
}
