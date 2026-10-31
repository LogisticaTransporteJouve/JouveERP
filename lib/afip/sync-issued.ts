import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";

import {
  CBTE_TIPO,
  CONDICION_IVA_RECEPTOR,
  DOC_TIPO,
  type InvoiceKind,
  type InvoiceLetter,
} from "./codes";
import type { ContributorInfo } from "./types";
import type { VoucherInfo } from "./wsfev1";

// Imports the vouchers this CUIT issued in ARCA (WSFEv1) that the ERP does
// not have yet — invoices emitted from ARCA's own web, another system, or
// history before the ERP. Per (punto de venta, cbte tipo) it walks forward
// from the highest local number to ARCA's last authorized one.

type Supabase = SupabaseClient<Database>;
type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];

export interface ArcaVoucherPort {
  getLastAuthorizedNumber(ptoVta: number, cbteTipo: number): Promise<number>;
  getVoucherInfo(
    ptoVta: number,
    cbteTipo: number,
    cbteNro: number,
  ): Promise<VoucherInfo | null>;
  /** Padrón A4 lookup, used to name clients the ERP does not have yet. */
  lookupContributor(cuit: string): Promise<ContributorInfo>;
}

export interface SyncTarget {
  punto_venta: number;
  channel_id: string;
}

export interface PairSyncResult {
  punto_venta: number;
  cbte_tipo: number;
  imported: number;
  missing: number;
  skipped_no_origin: number;
  last_authorized: number;
  last_local: number;
  /** Why the pair stopped early (in-flight emission, insert error). */
  stopped: string | null;
}

// Facturas first so NC/ND find their origin when both land in one run.
export const SYNC_CBTE_TIPOS = [
  CBTE_TIPO.FACTURA_A,
  CBTE_TIPO.FACTURA_B,
  CBTE_TIPO.ND_A,
  CBTE_TIPO.ND_B,
  CBTE_TIPO.NC_A,
  CBTE_TIPO.NC_B,
] as const;

const KIND_LETTER_BY_TIPO: Record<
  number,
  { kind: InvoiceKind; letter: InvoiceLetter }
> = {
  1: { kind: "factura", letter: "A" },
  2: { kind: "nd", letter: "A" },
  3: { kind: "nc", letter: "A" },
  6: { kind: "factura", letter: "B" },
  7: { kind: "nd", letter: "B" },
  8: { kind: "nc", letter: "B" },
  11: { kind: "factura", letter: "C" },
  12: { kind: "nd", letter: "C" },
  13: { kind: "nc", letter: "C" },
};

type ClientIvaCondition =
  | "responsable_inscripto"
  | "monotributo"
  | "exento"
  | "consumidor_final"
  | "no_categorizado";

const IVA_CONDITION_BY_RECEPTOR: Record<number, ClientIvaCondition> = {
  [CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO]: "responsable_inscripto",
  [CONDICION_IVA_RECEPTOR.EXENTO]: "exento",
  [CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL]: "consumidor_final",
  [CONDICION_IVA_RECEPTOR.MONOTRIBUTO]: "monotributo",
  [CONDICION_IVA_RECEPTOR.MONOTRIBUTO_SOCIAL]: "monotributo",
  [CONDICION_IVA_RECEPTOR.MONOTRIBUTO_PROMOVIDO]: "monotributo",
  [CONDICION_IVA_RECEPTOR.NO_CATEGORIZADO]: "no_categorizado",
};

/** Anchor client for vouchers to a DNI / consumidor final receiver. */
export const CONSUMIDOR_FINAL_CUIT = "00000000000";

function afipDateToIso(value: string | null): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** CUIT of the receiver when it is one, else the consumidor final anchor. */
export function receiverCuit(info: VoucherInfo): string {
  const doc = (info.docNro ?? "").replace(/\D/g, "");
  return info.docTipo === DOC_TIPO.CUIT && doc.length === 11
    ? doc
    : CONSUMIDOR_FINAL_CUIT;
}

export function clientIvaConditionFor(info: VoucherInfo): ClientIvaCondition {
  if (receiverCuit(info) === CONSUMIDOR_FINAL_CUIT) return "consumidor_final";
  const byReceptor =
    info.condicionIvaReceptorId == null
      ? undefined
      : IVA_CONDITION_BY_RECEPTOR[info.condicionIvaReceptorId];
  if (byReceptor) return byReceptor;
  return KIND_LETTER_BY_TIPO[info.cbteTipo]?.letter === "A"
    ? "responsable_inscripto"
    : "consumidor_final";
}

/** Maps an ARCA voucher to an `invoices` row (status `emitted`). Returns
 *  null for cbte tipos the ERP does not model. */
export function voucherToInvoiceInsert(
  info: VoucherInfo,
  ctx: {
    channelId: string;
    clientId: string;
    originId: string | null;
  },
): InvoiceInsert | null {
  const kl = KIND_LETTER_BY_TIPO[info.cbteTipo];
  const fecha = afipDateToIso(info.cbteFch);
  if (!kl || !fecha) return null;
  return {
    channel_id: ctx.channelId,
    client_id: ctx.clientId,
    kind: kl.kind,
    letter: kl.letter,
    punto_venta: info.ptoVta,
    numero: info.cbteNro,
    fecha,
    concepto: info.concepto ?? 1,
    doc_tipo: info.docTipo ?? DOC_TIPO.CONSUMIDOR_FINAL,
    doc_nro: info.docNro ?? "0",
    iva_condition_receptor:
      info.condicionIvaReceptorId ?? CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    cbte_tipo_afip: info.cbteTipo,
    cbte_tipo_origen_afip:
      kl.kind === "factura" ? null : (info.cbtesAsoc[0]?.tipo ?? null),
    invoice_origin_id: ctx.originId,
    imp_neto: info.impNeto,
    imp_iva: info.impIva,
    imp_trib: info.impTrib,
    imp_op_ex: info.impOpEx,
    imp_tot_conc: info.impTotConc,
    imp_total: info.impTotal,
    moneda: info.monId ?? "PES",
    cotizacion: info.monCotiz ?? 1,
    fch_serv_desde: afipDateToIso(info.fchServDesde),
    fch_serv_hasta: afipDateToIso(info.fchServHasta),
    fch_vto_pago: afipDateToIso(info.fchVtoPago),
    cae: info.cae,
    cae_vencimiento: afipDateToIso(info.caeFchVto),
    emission_type: info.emisionTipo?.toUpperCase() === "CAEA" ? "caea" : "cae",
    status: "emitted",
    emitted_at: `${fecha}T12:00:00-03:00`,
    idempotency_key: `arca-sync-${info.ptoVta}-${info.cbteTipo}-${info.cbteNro}`,
  };
}

/** Points of sale on an active fiscal channel: the only ones ARCA numbers. */
export async function listSyncTargets(
  supabase: Supabase,
): Promise<SyncTarget[]> {
  const { data, error } = await supabase
    .from("sales_points")
    .select(
      "numero, channel_id, channel:invoicing_channels(is_fiscal, is_active)",
    )
    .eq("is_enabled", true)
    .not("channel_id", "is", null)
    .order("numero");
  if (error) throw new Error(`sales_points: ${error.message}`);
  return (data ?? []).flatMap((row) =>
    row.channel_id && row.channel?.is_fiscal && row.channel.is_active
      ? [{ punto_venta: row.numero, channel_id: row.channel_id }]
      : [],
  );
}

async function lastLocalNumero(
  supabase: Supabase,
  pv: number,
  cbteTipo: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("invoices")
    .select("numero")
    .eq("punto_venta", pv)
    .eq("cbte_tipo_afip", cbteTipo)
    .not("numero", "is", null)
    .order("numero", { ascending: false })
    .limit(1);
  if (error) throw new Error(`last local numero: ${error.message}`);
  return data?.[0]?.numero ?? 0;
}

/** An ERP emission still waiting for its CAE owns the next ARCA number;
 *  importing it now would steal that number from the emission. */
async function hasInFlightEmission(
  supabase: Supabase,
  pv: number,
  cbteTipo: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("punto_venta", pv)
    .eq("cbte_tipo_afip", cbteTipo)
    .is("numero", null)
    .eq("status", "emitting")
    .limit(1);
  if (error) throw new Error(`in-flight check: ${error.message}`);
  return (data ?? []).length > 0;
}

async function resolveClientId(
  supabase: Supabase,
  afip: ArcaVoucherPort,
  info: VoucherInfo,
  cache: Map<string, string>,
): Promise<string> {
  const cuit = receiverCuit(info);
  const cached = cache.get(cuit);
  if (cached) return cached;

  const existing = await supabase
    .from("clients")
    .select("id")
    .eq("cuit", cuit)
    .maybeSingle();
  if (existing.error)
    throw new Error(`client lookup: ${existing.error.message}`);
  if (existing.data) {
    cache.set(cuit, existing.data.id);
    return existing.data.id;
  }

  let legalName =
    cuit === CONSUMIDOR_FINAL_CUIT ? "CONSUMIDOR FINAL" : `Cliente ${cuit}`;
  let ivaCondition = clientIvaConditionFor(info);
  if (cuit !== CONSUMIDOR_FINAL_CUIT) {
    try {
      const contributor = await afip.lookupContributor(cuit);
      if (contributor.legal_name) legalName = contributor.legal_name;
      ivaCondition = contributor.tax_condition;
    } catch (err) {
      logger.warn("arca_sync.padron_lookup_failed", {
        cuit,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const { error } = await supabase
    .from("clients")
    .upsert(
      { cuit, legal_name: legalName, iva_condition: ivaCondition },
      { onConflict: "cuit", ignoreDuplicates: true },
    );
  if (error) throw new Error(`client insert: ${error.message}`);
  const created = await supabase
    .from("clients")
    .select("id")
    .eq("cuit", cuit)
    .single();
  if (created.error) throw new Error(`client fetch: ${created.error.message}`);
  cache.set(cuit, created.data.id);
  return created.data.id;
}

async function resolveOriginId(
  supabase: Supabase,
  info: VoucherInfo,
): Promise<string | null> {
  const asoc = info.cbtesAsoc[0];
  if (!asoc) return null;
  const { data, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("punto_venta", asoc.ptoVta)
    .eq("cbte_tipo_afip", asoc.tipo)
    .eq("numero", asoc.nro)
    .limit(1);
  if (error) throw new Error(`origin lookup: ${error.message}`);
  return data?.[0]?.id ?? null;
}

/** Imports up to `limit` vouchers of one (pv, cbte tipo), oldest first. */
export async function syncIssuedPair(
  supabase: Supabase,
  afip: ArcaVoucherPort,
  target: SyncTarget,
  cbteTipo: number,
  limit: number,
): Promise<PairSyncResult> {
  const pv = target.punto_venta;
  const result: PairSyncResult = {
    punto_venta: pv,
    cbte_tipo: cbteTipo,
    imported: 0,
    missing: 0,
    skipped_no_origin: 0,
    last_authorized: 0,
    last_local: 0,
    stopped: null,
  };

  result.last_authorized = await afip.getLastAuthorizedNumber(pv, cbteTipo);
  result.last_local = await lastLocalNumero(supabase, pv, cbteTipo);
  if (result.last_authorized <= result.last_local) return result;

  if (await hasInFlightEmission(supabase, pv, cbteTipo)) {
    result.stopped = "Hay una emisión en curso en este punto de venta.";
    return result;
  }

  const clientCache = new Map<string, string>();
  const to = Math.min(result.last_authorized, result.last_local + limit);
  for (let nro = result.last_local + 1; nro <= to; nro++) {
    const info = await afip.getVoucherInfo(pv, cbteTipo, nro);
    if (!info) {
      result.missing += 1;
      continue;
    }

    const kind = KIND_LETTER_BY_TIPO[cbteTipo]?.kind;
    const originId =
      kind && kind !== "factura" ? await resolveOriginId(supabase, info) : null;
    if (kind !== "factura" && !originId) {
      // invoices_nc_nd_requires_origen: an NC/ND whose origin the ERP lacks
      // cannot be stored.
      result.skipped_no_origin += 1;
      logger.warn("arca_sync.nc_nd_without_origin", {
        punto_venta: pv,
        cbte_tipo: cbteTipo,
        numero: nro,
      });
      continue;
    }

    const clientId = await resolveClientId(supabase, afip, info, clientCache);
    const row = voucherToInvoiceInsert(info, {
      channelId: target.channel_id,
      clientId,
      originId,
    });
    if (!row) {
      result.missing += 1;
      continue;
    }

    const { error } = await supabase
      .from("invoices")
      .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error && error.code !== PG_UNIQUE_VIOLATION) {
      result.stopped = `No se pudo guardar el ${nro}: ${error.message}`;
      logger.error("arca_sync.insert_failed", {
        punto_venta: pv,
        cbte_tipo: cbteTipo,
        numero: nro,
        error: error.message,
      });
      return result;
    }
    if (!error) result.imported += 1;
  }
  return result;
}
