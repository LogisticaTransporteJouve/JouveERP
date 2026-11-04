import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";

import {
  CBTE_TIPO,
  CONDICION_IVA_RECEPTOR,
  DOC_TIPO,
  IVA_RATE_PERCENT,
  kindLetterForCbteTipo,
} from "./codes";
import { PadronNoConstanciaError } from "./padron";
import type { ContributorInfo } from "./types";
import type { VoucherInfo } from "./wsfev1";

// Imports the vouchers this CUIT issued in ARCA (WSFEv1) that the ERP does
// not have yet — invoices emitted from ARCA's own web, another system, or
// history before the ERP. Per (punto de venta, cbte tipo) it walks forward
// from the highest local number to ARCA's last authorized one.

type Supabase = SupabaseClient<Database>;
type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type ImportedItem = Omit<
  Database["public"]["Tables"]["invoice_items"]["Insert"],
  "invoice_id"
>;

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
  /** NC/ND below the last number that came in on a retry. */
  recovered: number;
  missing: number;
  /** NC/ND stored without an origin factura (also counted in imported). */
  unlinked: number;
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
  return kindLetterForCbteTipo(info.cbteTipo)?.letter === "A"
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
    /** NC/ND whose origin the ERP cannot resolve (see origin_unlinked). */
    originUnlinked?: boolean;
  },
): InvoiceInsert | null {
  const kl = kindLetterForCbteTipo(info.cbteTipo);
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
    origin_unlinked: ctx.originUnlinked ?? false,
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

const cents = (n: number) => Math.round(n * 100);

/** One `invoice_items` row per ARCA alícuota, so the Libro IVA, its TXT and
 *  the PDF read the voucher's own rates instead of inferring one from the
 *  header. Empty (the header-only import) when the breakdown is missing, names
 *  a rate the ERP does not model, or does not add up to the header neto and
 *  IVA to the cent. */
export function voucherToInvoiceItems(info: VoucherInfo): ImportedItem[] {
  if (info.iva.length === 0) return [];
  const valid = info.iva.every(
    (a) =>
      a.id in IVA_RATE_PERCENT &&
      Number.isFinite(a.baseImp) &&
      Number.isFinite(a.importe) &&
      a.baseImp >= 0 &&
      a.importe >= 0,
  );
  if (!valid) return [];
  const base = info.iva.reduce((s, a) => s + cents(a.baseImp), 0);
  const iva = info.iva.reduce((s, a) => s + cents(a.importe), 0);
  if (base !== cents(info.impNeto) || iva !== cents(info.impIva)) return [];
  return info.iva.map((a, i) => ({
    sort_order: i,
    description: "Importado de ARCA",
    quantity: 1,
    unit_price: a.baseImp,
    iva_rate_id: a.id,
    line_neto: a.baseImp,
    line_iva: a.importe,
    line_total: (cents(a.baseImp) + cents(a.importe)) / 100,
  }));
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

function placeholderName(cuit: string): string {
  return cuit === CONSUMIDOR_FINAL_CUIT
    ? "CONSUMIDOR FINAL"
    : `Cliente ${cuit}`;
}

/** Name (and IVA condition, when the constancia comes) from the padrón. */
async function lookupName(
  afip: Pick<ArcaVoucherPort, "lookupContributor">,
  cuit: string,
): Promise<{
  legalName: string | null;
  ivaCondition: ClientIvaCondition | null;
}> {
  try {
    const contributor = await afip.lookupContributor(cuit);
    return {
      legalName: contributor.legal_name || null,
      ivaCondition: contributor.tax_condition,
    };
  } catch (err) {
    logger.warn("arca_sync.padron_lookup_failed", {
      cuit,
      error: err instanceof Error ? err.message : String(err),
    });
    // Without a constancia AFIP still names the person; the IVA condition
    // stays the one printed on the voucher.
    return {
      legalName: err instanceof PadronNoConstanciaError ? err.legalName : null,
      ivaCondition: null,
    };
  }
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

  let legalName = placeholderName(cuit);
  let ivaCondition = clientIvaConditionFor(info);
  if (cuit !== CONSUMIDOR_FINAL_CUIT) {
    const found = await lookupName(afip, cuit);
    if (found.legalName) legalName = found.legalName;
    if (found.ivaCondition) ivaCondition = found.ivaCondition;
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

type OriginLookup =
  | { status: "found"; id: string; clientId: string }
  /** Same point of sale, numbered past what is imported: a later run brings it. */
  | { status: "pending"; nro: number }
  /** No reference, another point of sale, or a number already passed. */
  | { status: "missing" };

async function resolveOrigin(
  supabase: Supabase,
  afip: Pick<ArcaVoucherPort, "getLastAuthorizedNumber">,
  info: VoucherInfo,
): Promise<OriginLookup> {
  const asoc = info.cbtesAsoc[0];
  if (!asoc) return matchOriginByTotal(supabase, info);
  const { data, error } = await supabase
    .from("invoices")
    .select("id, client_id")
    .eq("punto_venta", asoc.ptoVta)
    .eq("cbte_tipo_afip", asoc.tipo)
    .eq("numero", asoc.nro)
    .limit(1);
  if (error) throw new Error(`origin lookup: ${error.message}`);
  const found = data?.[0];
  if (found)
    return { status: "found", id: found.id, clientId: found.client_id };
  // Only an origin the import itself brings in can be waited for: another
  // point of sale, or a tipo outside SYNC_CBTE_TIPOS (FCE MiPyME, tiques…),
  // would never arrive and would stall the pair.
  if (
    asoc.ptoVta !== info.ptoVta ||
    !(SYNC_CBTE_TIPOS as readonly number[]).includes(asoc.tipo)
  ) {
    return { status: "missing" };
  }
  const imported = await lastLocalNumero(supabase, asoc.ptoVta, asoc.tipo);
  if (asoc.nro <= imported) return { status: "missing" };
  // A number ARCA never authorized (a typo in CbtesAsoc) will not arrive
  // either.
  const authorized = await afip.getLastAuthorizedNumber(asoc.ptoVta, asoc.tipo);
  return asoc.nro <= authorized
    ? { status: "pending", nro: asoc.nro }
    : { status: "missing" };
}

/** NC/ND tipo → the factura tipo of the same letter. */
const FACTURA_TIPO_FOR_NOTE: Record<number, number> = {
  2: 1,
  3: 1,
  7: 6,
  8: 6,
  12: 11,
  13: 11,
};

/** Same-total facturas looked at for one note; past them it stays unlinked. */
const TOTAL_MATCH_CANDIDATES = 100;

/** NC statuses that already take credit off their origin, as in
 *  `invoice_open_amount`. */
const CREDITING_NC_STATUSES = ["draft", "emitting", "emitted"];

/** Older NC/ND (before ARCA required CbtesAsoc) carry no reference. The
 *  origin is then the factura of the same point of sale, letter and currency,
 *  to the same receiver, for the same total, on or before the note's date
 *  (latest wins). An NC only takes a factura whose linked NCs leave room for
 *  its whole total, so a guess never over-credits a factura. Without a match
 *  it stays missing and the note is stored unlinked. */
async function matchOriginByTotal(
  supabase: Supabase,
  info: VoucherInfo,
): Promise<OriginLookup> {
  const facturaTipo = FACTURA_TIPO_FOR_NOTE[info.cbteTipo];
  const fecha = afipDateToIso(info.cbteFch);
  if (!facturaTipo || !fecha || !info.docNro) return { status: "missing" };
  const { data, error } = await supabase
    .from("invoices")
    .select("id, client_id, imp_total")
    .eq("punto_venta", info.ptoVta)
    .eq("cbte_tipo_afip", facturaTipo)
    .eq("doc_nro", info.docNro)
    .eq("moneda", info.monId ?? "PES")
    .eq("imp_total", info.impTotal)
    .lte("fecha", fecha)
    .eq("status", "emitted")
    .order("fecha", { ascending: false })
    .limit(TOTAL_MATCH_CANDIDATES);
  if (error) throw new Error(`origin match: ${error.message}`);
  const candidates = data ?? [];
  const credited =
    kindLetterForCbteTipo(info.cbteTipo)?.kind === "nc"
      ? await creditedByNotes(
          supabase,
          candidates.map((c) => c.id),
        )
      : null;
  const found = candidates.find(
    (c) =>
      !credited ||
      cents(c.imp_total) - (credited.get(c.id) ?? 0) >= cents(info.impTotal),
  );
  return found
    ? { status: "found", id: found.id, clientId: found.client_id }
    : { status: "missing" };
}

/** Cents each factura already has credited by the NCs linked to it. */
async function creditedByNotes(
  supabase: Supabase,
  originIds: string[],
): Promise<Map<string, number>> {
  const credited = new Map<string, number>();
  if (originIds.length === 0) return credited;
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_origin_id, imp_total")
    .in("invoice_origin_id", originIds)
    .eq("kind", "nc")
    .in("status", CREDITING_NC_STATUSES);
  if (error) throw new Error(`origin credits: ${error.message}`);
  for (const n of data ?? []) {
    if (!n.invoice_origin_id) continue;
    credited.set(
      n.invoice_origin_id,
      (credited.get(n.invoice_origin_id) ?? 0) + cents(n.imp_total),
    );
  }
  return credited;
}

const SUPPORTED_MONEDAS: readonly string[] = ["PES", "DOL"];

type VoucherOutcome =
  | { kind: "imported"; unlinked: boolean }
  | { kind: "missing"; reason?: string }
  | { kind: "waiting_origin"; originNro: number }
  | { kind: "failed"; message: string };

async function importVoucher(
  supabase: Supabase,
  afip: ArcaVoucherPort,
  target: SyncTarget,
  cbteTipo: number,
  nro: number,
  clientCache: Map<string, string>,
): Promise<VoucherOutcome> {
  const info = await afip.getVoucherInfo(target.punto_venta, cbteTipo, nro);
  if (!info) return { kind: "missing" };
  // The aging, receipts and NC spread model only pesos and dollars; another
  // currency would be counted as pesos there, so it is left as a gap.
  const moneda = info.monId ?? "PES";
  if (!SUPPORTED_MONEDAS.includes(moneda)) {
    logger.warn("arca_sync.unsupported_currency", {
      punto_venta: info.ptoVta,
      cbte_tipo: info.cbteTipo,
      numero: info.cbteNro,
      moneda,
    });
    return { kind: "missing", reason: `moneda no soportada (${moneda})` };
  }

  const kind = kindLetterForCbteTipo(cbteTipo)?.kind;
  const origin =
    kind && kind !== "factura"
      ? await resolveOrigin(supabase, afip, info)
      : null;
  if (origin?.status === "pending") {
    return { kind: "waiting_origin", originNro: origin.nro };
  }
  const clientId = await resolveClientId(supabase, afip, info, clientCache);
  // guard_invoice_origin rejects an origin of another client; ARCA allows an
  // NC/ND to a receiver other than the factura's (e.g. factura to consumidor
  // final, note to a CUIT), so such a reference cannot be kept.
  const originId =
    origin?.status === "found" && origin.clientId === clientId
      ? origin.id
      : null;
  // An NC/ND ARCA ties to no factura we can find (older ones carried no
  // CbtesAsoc: interest debits, general or partial credits) is stored
  // unlinked so it still reaches the client's account and the IVA book.
  const unlinked = kind !== "factura" && !originId;
  const row = voucherToInvoiceInsert(info, {
    channelId: target.channel_id,
    clientId,
    originId,
    originUnlinked: unlinked,
  });
  if (!row) return { kind: "missing" };

  const items = voucherToInvoiceItems(info);
  if (items.length === 0 && info.iva.length > 0) {
    logger.warn("arca_sync.iva_breakdown_skipped", {
      punto_venta: info.ptoVta,
      cbte_tipo: info.cbteTipo,
      numero: info.cbteNro,
    });
  }
  // Header and items in one transaction: a kill or a failed items write
  // leaves nothing, and the next run imports the voucher again. A key
  // already imported inserts nothing (null).
  const { error } = await supabase.rpc("import_arca_issued_invoice", {
    p_invoice: row,
    p_items: items,
  });
  if (error && error.code !== PG_UNIQUE_VIOLATION) {
    return { kind: "failed", message: error.message };
  }
  if (error) return { kind: "missing" };
  return { kind: "imported", unlinked };
}

const GAP_PAGE = 1000;

/** Numbers below `upTo` the ERP does not have for this (pv, cbte tipo). */
async function localGaps(
  supabase: Supabase,
  pv: number,
  cbteTipo: number,
  upTo: number,
): Promise<number[]> {
  const have = new Set<number>();
  for (let from = 0; ; from += GAP_PAGE) {
    const { data, error } = await supabase
      .from("invoices")
      .select("numero")
      .eq("punto_venta", pv)
      .eq("cbte_tipo_afip", cbteTipo)
      .not("numero", "is", null)
      .lte("numero", upTo)
      .order("numero")
      .range(from, from + GAP_PAGE - 1);
    if (error) throw new Error(`local numbers: ${error.message}`);
    for (const r of data ?? []) if (r.numero != null) have.add(r.numero);
    if ((data ?? []).length < GAP_PAGE) break;
  }
  const gaps: number[] = [];
  for (let n = 1; n <= upTo; n++) if (!have.has(n)) gaps.push(n);
  return gaps;
}

/** A `size` window of `gaps` that moves every day (the sync runs nightly), so
 *  gaps that never resolve (origin on another point of sale) cannot starve
 *  the rest. */
export function dailyWindow<T>(gaps: T[], size: number, now = Date.now()): T[] {
  if (gaps.length <= size) return gaps;
  const windows = Math.ceil(gaps.length / size);
  const start = (Math.floor(now / 86_400_000) % windows) * size;
  return gaps.slice(start, start + size);
}

/** Imports up to `limit` vouchers of one (pv, cbte tipo), oldest first.
 *  With `retryGaps`, NC/ND left behind below the last imported number (their
 *  origin was missing then) are tried again first. */
export async function syncIssuedPair(
  supabase: Supabase,
  afip: ArcaVoucherPort,
  target: SyncTarget,
  cbteTipo: number,
  limit: number,
  opts: { retryGaps?: boolean } = {},
): Promise<PairSyncResult> {
  const pv = target.punto_venta;
  const result: PairSyncResult = {
    punto_venta: pv,
    cbte_tipo: cbteTipo,
    imported: 0,
    recovered: 0,
    missing: 0,
    unlinked: 0,
    last_authorized: 0,
    last_local: 0,
    stopped: null,
  };

  result.last_authorized = await afip.getLastAuthorizedNumber(pv, cbteTipo);
  result.last_local = await lastLocalNumero(supabase, pv, cbteTipo);

  if (await hasInFlightEmission(supabase, pv, cbteTipo)) {
    result.stopped = "Hay una emisión en curso en este punto de venta.";
    return result;
  }

  const clientCache = new Map<string, string>();
  const isNcNd = kindLetterForCbteTipo(cbteTipo)?.kind !== "factura";

  if (opts.retryGaps && isNcNd && result.last_local > 0) {
    const gaps = dailyWindow(
      await localGaps(supabase, pv, cbteTipo, result.last_local),
      limit,
    );
    for (const nro of gaps) {
      const outcome = await importVoucher(
        supabase,
        afip,
        target,
        cbteTipo,
        nro,
        clientCache,
      );
      if (outcome.kind === "imported") {
        result.recovered += 1;
        continue;
      }
      // Leave a trace of every gap that stays open, so the reconciliation's
      // remaining numbers always have a reason in the logs.
      logger.warn("arca_sync.gap_unresolved", {
        punto_venta: pv,
        cbte_tipo: cbteTipo,
        numero: nro,
        reason:
          outcome.kind === "missing"
            ? (outcome.reason ?? "ARCA no devolvió el comprobante")
            : outcome.kind === "waiting_origin"
              ? `espera su origen ${outcome.originNro}`
              : outcome.message,
      });
      if (outcome.kind === "failed") {
        result.stopped = `No se pudo guardar el ${nro}: ${outcome.message}`;
        return result;
      }
    }
  }

  const to = Math.min(result.last_authorized, result.last_local + limit);
  for (let nro = result.last_local + 1; nro <= to; nro++) {
    const outcome = await importVoucher(
      supabase,
      afip,
      target,
      cbteTipo,
      nro,
      clientCache,
    );
    switch (outcome.kind) {
      case "imported":
        result.imported += 1;
        if (outcome.unlinked) {
          result.unlinked += 1;
          logger.info("arca_sync.nc_nd_unlinked", {
            punto_venta: pv,
            cbte_tipo: cbteTipo,
            numero: nro,
          });
        }
        break;
      case "missing":
        result.missing += 1;
        break;
      case "waiting_origin":
        // The facturas walk a long history slower than the NC/ND do; passing
        // this one would leave it behind, so the pair waits for its origin.
        result.stopped = `La ${nro} espera su comprobante de origen (${outcome.originNro}), que todavía no se importó.`;
        return result;
      case "failed":
        result.stopped = `No se pudo guardar el ${nro}: ${outcome.message}`;
        logger.error("arca_sync.insert_failed", {
          punto_venta: pv,
          cbte_tipo: cbteTipo,
          numero: nro,
          error: outcome.message,
        });
        return result;
    }
  }
  return result;
}

export const CBTE_TIPO_LABEL: Record<number, string> = {
  1: "Factura A",
  2: "Nota de débito A",
  3: "Nota de crédito A",
  6: "Factura B",
  7: "Nota de débito B",
  8: "Nota de crédito B",
};

export interface PairReconciliation {
  punto_venta: number;
  cbte_tipo: number;
  label: string;
  /** Last number ARCA authorized; it numbers each (pv, tipo) without gaps. */
  last_authorized: number;
  /** Highest number in the ERP for this (pv, tipo). */
  last_local: number;
  /** Numbers above the ERP's highest: the import has not reached them yet. */
  not_imported_yet: number;
  /** Numbers below the ERP's highest that the ERP does not have. */
  gaps: number;
  gap_sample: number[];
}

const GAP_SAMPLE = 20;

/** Compares one (pv, cbte tipo) in the ERP against ARCA's numbering. */
export async function reconcilePair(
  supabase: Supabase,
  afip: Pick<ArcaVoucherPort, "getLastAuthorizedNumber">,
  target: SyncTarget,
  cbteTipo: number,
): Promise<PairReconciliation> {
  const pv = target.punto_venta;
  const [lastAuthorized, lastLocal] = await Promise.all([
    afip.getLastAuthorizedNumber(pv, cbteTipo),
    lastLocalNumero(supabase, pv, cbteTipo),
  ]);
  const gaps =
    lastLocal > 0 ? await localGaps(supabase, pv, cbteTipo, lastLocal) : [];
  return {
    punto_venta: pv,
    cbte_tipo: cbteTipo,
    label: CBTE_TIPO_LABEL[cbteTipo] ?? `Tipo ${cbteTipo}`,
    last_authorized: lastAuthorized,
    last_local: lastLocal,
    not_imported_yet: Math.max(0, lastAuthorized - lastLocal),
    gaps: gaps.length,
    gap_sample: gaps.slice(0, GAP_SAMPLE),
  };
}

/** Clients an earlier import could not name ("Cliente <CUIT>"): asks the
 *  padrón again, `limit` per call in a daily rotating window so the ones
 *  AFIP never names do not starve the rest. */
export async function renamePlaceholderClients(
  supabase: Supabase,
  afip: Pick<ArcaVoucherPort, "lookupContributor">,
  limit: number,
): Promise<{ checked: number; renamed: number }> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, cuit, legal_name")
    .eq("is_fiscal", true)
    .like("legal_name", "Cliente %")
    .order("created_at")
    .limit(1000);
  if (error) throw new Error(`placeholder clients: ${error.message}`);
  const batch = dailyWindow(data ?? [], limit);
  let renamed = 0;
  for (const client of batch) {
    if (!client.cuit || client.legal_name !== placeholderName(client.cuit)) {
      continue;
    }
    const found = await lookupName(afip, client.cuit);
    if (!found.legalName) continue;
    const upd = await supabase
      .from("clients")
      .update({ legal_name: found.legalName })
      .eq("id", client.id)
      .eq("legal_name", client.legal_name);
    if (upd.error) throw new Error(`client rename: ${upd.error.message}`);
    renamed += 1;
  }
  return { checked: batch.length, renamed };
}
