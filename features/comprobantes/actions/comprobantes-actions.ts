"use server";

import { randomUUID } from "node:crypto";

import {
  cbteTipoFor,
  letterFor,
  type CbteTipoCode,
  type ComprobanteLetter,
} from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { inngest } from "@/lib/inngest/client";
import { INVOICE_ISSUE_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import {
  CreateComprobanteSchema,
  computeTotals,
  narrowComprobanteRow,
  type ComprobanteRow,
  type CreateComprobanteInput,
} from "../schema";

import type { IvaCondition } from "@/features/clients/schema";

type ComprobanteInsert =
  Database["public"]["Tables"]["comprobantes"]["Insert"];
type ComprobanteItemInsert =
  Database["public"]["Tables"]["comprobante_items"]["Insert"];

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface IssueInvoiceResult {
  id: string;
  idempotency_key: string;
  status: ComprobanteRow["status"];
}

interface ChannelInfo {
  id: string;
  is_fiscal: boolean;
  is_active: boolean;
}

interface ClientInfo {
  id: string;
  is_active: boolean;
  iva_condition: IvaCondition;
}

async function loadChannel(
  supabase: ReturnType<typeof getServiceClient>,
  channelId: string,
): Promise<ChannelInfo | null> {
  const { data, error } = await supabase
    .from("invoicing_channels")
    .select("id, is_fiscal, is_active")
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw new Error(`load-channel: ${error.message}`);
  return data;
}

async function loadClient(
  supabase: ReturnType<typeof getServiceClient>,
  clientId: string,
): Promise<ClientInfo | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, is_active, iva_condition")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`load-client: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    is_active: data.is_active,
    iva_condition: data.iva_condition as IvaCondition,
  };
}

async function loadEnabledPos(
  supabase: ReturnType<typeof getServiceClient>,
  numero: number,
  channelId: string,
): Promise<{ numero: number; channel_id: string | null } | null> {
  const { data, error } = await supabase
    .from("puntos_de_venta")
    .select("numero, channel_id, is_enabled")
    .eq("numero", numero)
    .maybeSingle();
  if (error) throw new Error(`load-pos: ${error.message}`);
  if (!data) return null;
  if (!data.is_enabled) return null;
  if (data.channel_id !== channelId) return null;
  return { numero: data.numero, channel_id: data.channel_id };
}

export async function issueFiscalInvoiceAction(
  input: CreateComprobanteInput,
): Promise<ActionResult<IssueInvoiceResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso para emitir comprobantes." };
  }

  const parsed = CreateComprobanteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = getServiceClient();

  const [channel, client] = await Promise.all([
    loadChannel(supabase, data.channel_id),
    loadClient(supabase, data.client_id),
  ]);
  if (!channel) return { ok: false, error: "Canal no existe." };
  if (!channel.is_active)
    return { ok: false, error: "El canal está inactivo." };
  if (!client) return { ok: false, error: "Cliente no existe." };
  if (!client.is_active)
    return { ok: false, error: "El cliente está inactivo." };

  if (!channel.is_fiscal) {
    return {
      ok: false,
      error:
        "Comprobante interno todavía no soportado. Llega en E.7 (post-MVP).",
    };
  }

  // Fiscal-specific resolution.
  const letter: ComprobanteLetter = data.letter ?? letterFor(client.iva_condition);
  const cbteTipoAfip: CbteTipoCode = cbteTipoFor(data.kind, letter);

  if (data.iva_condition_receptor === null) {
    return {
      ok: false,
      error:
        "Para emitir fiscal hace falta CondicionIVAReceptorId (RG 5616).",
    };
  }

  const pos = await loadEnabledPos(supabase, data.punto_venta, data.channel_id);
  if (!pos) {
    return {
      ok: false,
      error: `Punto de venta ${data.punto_venta} no está configurado o no pertenece a ${data.channel_id}.`,
    };
  }

  const totals = computeTotals(data.items, true);
  const idempotency_key = randomUUID();

  // Insert draft + items. The DB trigger validates the fiscal-fields
  // constraint, the unique index validates non-duplicate idempotency_key.
  const draft: ComprobanteInsert = {
    channel_id: data.channel_id,
    client_id: data.client_id,
    kind: data.kind,
    letter,
    cbte_tipo_afip: cbteTipoAfip,
    punto_venta: data.punto_venta,
    numero: null, // reserved by Inngest step before requestCAE
    fecha: data.fecha,
    fch_serv_desde: data.fch_serv_desde ?? null,
    fch_serv_hasta: data.fch_serv_hasta ?? null,
    fch_vto_pago: data.fch_vto_pago ?? null,
    concepto: data.concepto,
    doc_tipo: data.doc_tipo,
    doc_nro: data.doc_nro,
    iva_condition_receptor: data.iva_condition_receptor,
    imp_neto: totals.imp_neto,
    imp_iva: totals.imp_iva,
    imp_trib: 0,
    imp_tot_conc: 0,
    imp_op_ex: 0,
    imp_total: totals.imp_total,
    moneda: data.moneda,
    cotizacion: data.cotizacion,
    status: "draft",
    comprobante_origen_id: data.comprobante_origen_id ?? null,
    motivo_nc_nd: data.motivo_nc_nd ?? null,
    idempotency_key,
    created_by: ctx.userId,
  };

  const inserted = await supabase
    .from("comprobantes")
    .insert(draft)
    .select("id")
    .maybeSingle();
  if (inserted.error || !inserted.data) {
    logger.warn("issue_invoice.insert_draft_failed", {
      err: inserted.error?.message,
    });
    return {
      ok: false,
      error: inserted.error?.message ?? "No se pudo crear el borrador.",
    };
  }
  const comprobante_id = inserted.data.id;

  const itemRows: ComprobanteItemInsert[] = data.items.map((item, index) => {
    const lineNeto = round2(item.quantity * item.unit_price);
    const lineIvaPct =
      item.iva_rate_id === null
        ? 0
        : item.iva_rate_id === 3
          ? 0
          : item.iva_rate_id === 4
            ? 10.5
            : item.iva_rate_id === 5
              ? 21
              : item.iva_rate_id === 6
                ? 27
                : item.iva_rate_id === 8
                  ? 5
                  : 2.5;
    const lineIva = round2((lineNeto * lineIvaPct) / 100);
    return {
      comprobante_id,
      sort_order: index,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      iva_rate_id: item.iva_rate_id,
      line_neto: lineNeto,
      line_iva: lineIva,
      line_total: round2(lineNeto + lineIva),
    };
  });

  const itemsRes = await supabase.from("comprobante_items").insert(itemRows);
  if (itemsRes.error) {
    // Roll back the draft so a retry doesn't see a half-written row.
    await supabase.from("comprobantes").delete().eq("id", comprobante_id);
    return { ok: false, error: itemsRes.error.message };
  }

  try {
    await inngest.send({
      name: INVOICE_ISSUE_REQUESTED,
      data: { comprobante_id, idempotency_key },
    });
  } catch (err) {
    // Roll back the draft so the user can retry cleanly. The most common
    // failure here is "Inngest dev runtime not running" — surface a hint
    // instead of the bare "fetch failed".
    await supabase.from("comprobantes").delete().eq("id", comprobante_id);
    const message = err instanceof Error ? err.message : "Error desconocido";
    const isFetchFailure =
      message.toLowerCase().includes("fetch failed") ||
      message.toLowerCase().includes("econnrefused");
    return {
      ok: false,
      error: isFetchFailure
        ? "No se pudo despachar el evento a Inngest. Verificá que `inngest-cli dev` esté corriendo en localhost:8288."
        : `No se pudo despachar el evento a Inngest: ${message}`,
    };
  }

  return {
    ok: true,
    data: {
      id: comprobante_id,
      idempotency_key,
      status: "draft",
    },
  };
}

export interface InvoiceStatus {
  id: string;
  status: ComprobanteRow["status"];
  cae: string | null;
  cae_vencimiento: string | null;
  numero: number | null; // null = draft pending reservation
  punto_venta: number;
  emitted_at: string | null;
  afip_observaciones: unknown;
}

export async function getInvoiceStatusAction(
  id: string,
): Promise<ActionResult<InvoiceStatus>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver comprobantes." };
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("comprobantes")
    .select(
      "id, status, cae, cae_vencimiento, numero, punto_venta, emitted_at, afip_observaciones",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data)
    return { ok: false, error: `Comprobante ${id} no encontrado.` };

  const row = narrowComprobanteRow(data as never);
  return {
    ok: true,
    data: {
      id: row.id,
      status: row.status,
      cae: row.cae,
      cae_vencimiento: row.cae_vencimiento,
      numero: row.numero,
      punto_venta: row.punto_venta,
      emitted_at: row.emitted_at,
      afip_observaciones: row.afip_observaciones,
    },
  };
}

// ---------------------------------------------------------------------------
// Listing / filtering
// ---------------------------------------------------------------------------

export interface ListComprobantesFilters {
  channel_id?: string | null;
  status?: ComprobanteRow["status"] | null;
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  client_id?: string | null;
  query?: string | null;
  offset?: number | null;
  limit?: number | null;
}

export interface ComprobanteListItem {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_is_fiscal: boolean;
  client_id: string;
  client_legal_name: string;
  kind: ComprobanteRow["kind"];
  letter: ComprobanteRow["letter"];
  punto_venta: number;
  numero: number;
  fecha: string;
  imp_total: number;
  status: ComprobanteRow["status"];
  cae: string | null;
  emitted_at: string | null;
}

const DEFAULT_PAGE_SIZE = 50;

export async function listComprobantesAction(
  filters: ListComprobantesFilters = {},
): Promise<
  ActionResult<{ items: ComprobanteListItem[]; nextOffset: number | null }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver comprobantes." };
  }

  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(200, Math.max(1, filters.limit ?? DEFAULT_PAGE_SIZE));

  const supabase = getServiceClient();
  let query = supabase
    .from("comprobantes")
    .select(
      `id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, imp_total, status, cae, emitted_at,
       channel:invoicing_channels(name, is_fiscal),
       client:clients(legal_name)`,
    )
    .order("fecha", { ascending: false })
    .order("numero", { ascending: false })
    .range(offset, offset + limit); // limit + 1 trick

  if (filters.channel_id) query = query.eq("channel_id", filters.channel_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.fecha_desde) query = query.gte("fecha", filters.fecha_desde);
  if (filters.fecha_hasta) query = query.lte("fecha", filters.fecha_hasta);
  if (filters.client_id) query = query.eq("client_id", filters.client_id);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<{
    id: string;
    channel_id: string;
    client_id: string;
    kind: string;
    letter: string | null;
    punto_venta: number;
    numero: number;
    fecha: string;
    imp_total: number | string;
    status: string;
    cae: string | null;
    emitted_at: string | null;
    channel: { name: string; is_fiscal: boolean } | null;
    client: { legal_name: string } | null;
  }>;

  const fullPage = rows.length > limit;
  const sliced = fullPage ? rows.slice(0, limit) : rows;

  const items: ComprobanteListItem[] = sliced.map((row) => ({
    id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel?.name ?? row.channel_id,
    channel_is_fiscal: row.channel?.is_fiscal ?? false,
    client_id: row.client_id,
    client_legal_name: row.client?.legal_name ?? "—",
    kind: row.kind as ComprobanteRow["kind"],
    letter: row.letter as ComprobanteRow["letter"],
    punto_venta: row.punto_venta,
    numero: row.numero,
    fecha: row.fecha,
    imp_total: Number(row.imp_total),
    status: row.status as ComprobanteRow["status"],
    cae: row.cae,
    emitted_at: row.emitted_at,
  }));

  return {
    ok: true,
    data: {
      items,
      nextOffset: fullPage ? offset + limit : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface ComprobanteDetail {
  id: string;
  channel: { id: string; name: string; is_fiscal: boolean };
  client: { id: string; legal_name: string; iva_condition: IvaCondition };
  kind: ComprobanteRow["kind"];
  letter: ComprobanteRow["letter"];
  punto_venta: number;
  numero: number;
  fecha: string;
  fch_serv_desde: string | null;
  fch_serv_hasta: string | null;
  fch_vto_pago: string | null;
  concepto: number;
  doc_tipo: number;
  doc_nro: string;
  iva_condition_receptor: number | null;
  imp_neto: number;
  imp_iva: number;
  imp_trib: number;
  imp_tot_conc: number;
  imp_op_ex: number;
  imp_total: number;
  moneda: string;
  cotizacion: number;
  cae: string | null;
  cae_vencimiento: string | null;
  afip_observaciones: unknown;
  status: ComprobanteRow["status"];
  pdf_url: string | null;
  motivo_nc_nd: string | null;
  emitted_at: string | null;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    iva_rate_id: number | null;
    line_neto: number;
    line_iva: number;
    line_total: number;
    sort_order: number;
  }>;
}

export async function getComprobanteDetailAction(
  id: string,
): Promise<ActionResult<ComprobanteDetail>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver comprobantes." };
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("comprobantes")
    .select(
      `*,
       channel:invoicing_channels(id, name, is_fiscal),
       client:clients(id, legal_name, iva_condition),
       items:comprobante_items(id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total, sort_order)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `Comprobante ${id} no encontrado.` };

  const row = data as unknown as {
    id: string;
    kind: string;
    letter: string | null;
    punto_venta: number;
    numero: number;
    fecha: string;
    fch_serv_desde: string | null;
    fch_serv_hasta: string | null;
    fch_vto_pago: string | null;
    concepto: number;
    doc_tipo: number;
    doc_nro: string;
    iva_condition_receptor: number | null;
    imp_neto: number | string;
    imp_iva: number | string;
    imp_trib: number | string;
    imp_tot_conc: number | string;
    imp_op_ex: number | string;
    imp_total: number | string;
    moneda: string;
    cotizacion: number | string;
    cae: string | null;
    cae_vencimiento: string | null;
    afip_observaciones: unknown;
    status: string;
    pdf_url: string | null;
    motivo_nc_nd: string | null;
    emitted_at: string | null;
    channel: { id: string; name: string; is_fiscal: boolean } | null;
    client: { id: string; legal_name: string; iva_condition: string } | null;
    items: Array<{
      id: string;
      description: string;
      quantity: number | string;
      unit_price: number | string;
      iva_rate_id: number | null;
      line_neto: number | string;
      line_iva: number | string;
      line_total: number | string;
      sort_order: number;
    }> | null;
  };

  if (!row.channel || !row.client) {
    return { ok: false, error: "Comprobante con relaciones inválidas." };
  }

  return {
    ok: true,
    data: {
      id: row.id,
      channel: row.channel,
      client: {
        id: row.client.id,
        legal_name: row.client.legal_name,
        iva_condition: row.client.iva_condition as IvaCondition,
      },
      kind: row.kind as ComprobanteRow["kind"],
      letter: row.letter as ComprobanteRow["letter"],
      punto_venta: row.punto_venta,
      numero: row.numero,
      fecha: row.fecha,
      fch_serv_desde: row.fch_serv_desde,
      fch_serv_hasta: row.fch_serv_hasta,
      fch_vto_pago: row.fch_vto_pago,
      concepto: row.concepto,
      doc_tipo: row.doc_tipo,
      doc_nro: row.doc_nro,
      iva_condition_receptor: row.iva_condition_receptor,
      imp_neto: Number(row.imp_neto),
      imp_iva: Number(row.imp_iva),
      imp_trib: Number(row.imp_trib),
      imp_tot_conc: Number(row.imp_tot_conc),
      imp_op_ex: Number(row.imp_op_ex),
      imp_total: Number(row.imp_total),
      moneda: row.moneda,
      cotizacion: Number(row.cotizacion),
      cae: row.cae,
      cae_vencimiento: row.cae_vencimiento,
      afip_observaciones: row.afip_observaciones,
      status: row.status as ComprobanteRow["status"],
      pdf_url: row.pdf_url,
      motivo_nc_nd: row.motivo_nc_nd,
      emitted_at: row.emitted_at,
      items: (row.items ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((it) => ({
          id: it.id,
          description: it.description,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
          iva_rate_id: it.iva_rate_id,
          line_neto: Number(it.line_neto),
          line_iva: Number(it.line_iva),
          line_total: Number(it.line_total),
          sort_order: it.sort_order,
        })),
    },
  };
}

// ---------------------------------------------------------------------------
// Lookups consumed by the new-comprobante form
// ---------------------------------------------------------------------------

export interface FiscalChannelOption {
  id: string;
  name: string;
  is_fiscal: boolean;
}

export async function listFiscalChannelsAction(): Promise<
  ActionResult<FiscalChannelOption[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("invoicing_channels")
    .select("id, name, is_fiscal, is_active")
    .eq("is_active", true)
    .eq("is_fiscal", true)
    .order("name");
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      is_fiscal: c.is_fiscal,
    })),
  };
}

export interface PosOption {
  numero: number;
  channel_id: string;
  nickname: string | null;
}

export async function listEnabledPosAction(
  channelId: string,
): Promise<ActionResult<PosOption[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("puntos_de_venta")
    .select("numero, channel_id, nickname, is_enabled")
    .eq("channel_id", channelId)
    .eq("is_enabled", true)
    .order("numero");
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((p) => ({
      numero: p.numero,
      channel_id: p.channel_id ?? channelId,
      nickname: p.nickname,
    })),
  };
}

// ---------------------------------------------------------------------------
// PDF regeneration (recovery if the post-CAE step failed)
// ---------------------------------------------------------------------------

export async function regeneratePdfAction(
  id: string,
): Promise<ActionResult<{ pdf_url: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso." };
  }
  try {
    const { generateAndStoreInvoicePdf } = await import(
      "@/lib/pdf/generate-and-store"
    );
    const result = await generateAndStoreInvoicePdf(id);
    return { ok: true, data: { pdf_url: result.signedUrl } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error generando PDF.",
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
