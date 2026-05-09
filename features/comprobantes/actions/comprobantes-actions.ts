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
    numero: 0, // reserved by Inngest step before requestCAE
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

  await inngest.send({
    name: INVOICE_ISSUE_REQUESTED,
    data: { comprobante_id, idempotency_key },
  });

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
  numero: number;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
