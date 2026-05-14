"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  PurchaseInvoiceCancelSchema,
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceUpdateSchema,
  isPurchaseInvoiceKind,
  isPurchaseInvoiceStatus,
  type PurchaseInvoice,
  type PurchaseInvoiceLetter,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

const UNIQUE_VIOLATION = "23505";

async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    event_type: eventType,
    target_resource_id: targetResourceId ?? null,
    payload,
  });
  if (error) logger.error("audit.insert.failed", { eventType, error });
}

function narrowRow(row: Record<string, unknown>): PurchaseInvoice | null {
  if (!isPurchaseInvoiceKind(row.kind)) return null;
  if (!isPurchaseInvoiceStatus(row.status)) return null;
  return {
    ...(row as unknown as PurchaseInvoice),
    letter: row.letter as PurchaseInvoiceLetter | null,
  };
}

export type SearchPurchaseInvoicesInput = {
  query?: string;
  supplierId?: string | null;
  channelId?: string | null;
  status?: string | null;
  fechaFrom?: string | null;
  fechaTo?: string | null;
  offset?: number;
  limit?: number;
};

export type SearchPurchaseInvoicesPage = {
  invoices: PurchaseInvoice[];
  nextOffset: number | null;
};

export async function searchPurchaseInvoicesAction(
  input: SearchPurchaseInvoicesInput = {},
): Promise<ActionResult<SearchPurchaseInvoicesPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver facturas de compra." };
  }

  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_purchase_invoices", {
    p_query: (input.query ?? "").trim(),
    p_supplier_id: input.supplierId ?? undefined,
    p_channel_id: input.channelId ?? undefined,
    p_status: input.status ?? undefined,
    p_fecha_from: input.fechaFrom ?? undefined,
    p_fecha_to: input.fechaTo ?? undefined,
    p_offset: offset,
    p_limit: limit + 1,
  });

  if (error) {
    logger.error("purchase_invoices.search.failed", { error });
    return { ok: false, error: "No se pudo buscar facturas de compra." };
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const invoices = rows
    .slice(0, limit)
    .map((row) => narrowRow(row as Record<string, unknown>))
    .filter((r): r is PurchaseInvoice => r !== null);

  return {
    ok: true,
    data: { invoices, nextOffset: hasMore ? offset + limit : null },
  };
}

const DETAIL_COLS =
  "id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, imp_neto, imp_iva, imp_trib, imp_total, moneda, cotizacion, cae_proveedor, cae_vto_proveedor, status, invoice_origin_id, motivo_nc_nd, notes, created_by, cancelled_at, cancelled_by, created_at, updated_at, suppliers!inner(legal_name, cuit)";

export async function getPurchaseInvoiceByIdAction(
  id: string,
): Promise<ActionResult<PurchaseInvoice | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver facturas de compra." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_invoices")
    .select(DETAIL_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("purchase_invoices.get.failed", { id, error });
    return { ok: false, error: "No se pudo cargar la factura." };
  }
  if (!data) return { ok: true, data: null };

  const supplier = (data as unknown as { suppliers: { legal_name: string; cuit: string } }).suppliers;
  const flat = {
    ...data,
    supplier_legal_name: supplier.legal_name,
    supplier_cuit: supplier.cuit,
  } as Record<string, unknown>;
  delete flat.suppliers;

  return { ok: true, data: narrowRow(flat) };
}

export async function createPurchaseInvoiceAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:write")) {
    return { ok: false, error: "No tenés permiso para cargar facturas de compra." };
  }

  const parsed = PurchaseInvoiceCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_invoices")
    .insert({
      channel_id: parsed.data.channel_id,
      supplier_id: parsed.data.supplier_id,
      kind: parsed.data.kind,
      letter: parsed.data.letter ?? null,
      punto_venta: parsed.data.punto_venta,
      numero: parsed.data.numero,
      fecha: parsed.data.fecha,
      fch_vto_pago: parsed.data.fch_vto_pago ?? null,
      imp_neto: parsed.data.imp_neto,
      imp_iva: parsed.data.imp_iva,
      imp_trib: parsed.data.imp_trib,
      imp_total: parsed.data.imp_total,
      moneda: parsed.data.moneda,
      cotizacion: parsed.data.cotizacion,
      cae_proveedor: parsed.data.cae_proveedor ?? null,
      cae_vto_proveedor: parsed.data.cae_vto_proveedor ?? null,
      invoice_origin_id: parsed.data.invoice_origin_id ?? null,
      motivo_nc_nd: parsed.data.motivo_nc_nd ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error:
          "Ya cargaste esta factura del proveedor (mismo tipo / letra / PV / número).",
      };
    }
    logger.error("purchase_invoices.create.failed", { error });
    return { ok: false, error: "No se pudo cargar la factura." };
  }

  await logAudit(
    "purchase_invoice.created",
    ctx.userId,
    {
      supplier_id: parsed.data.supplier_id,
      kind: parsed.data.kind,
      numero: parsed.data.numero,
      imp_total: parsed.data.imp_total,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updatePurchaseInvoiceAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:write")) {
    return { ok: false, error: "No tenés permiso para editar facturas de compra." };
  }

  const parsed = PurchaseInvoiceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_invoices")
    .update({
      ...(rest.channel_id !== undefined && { channel_id: rest.channel_id }),
      ...(rest.supplier_id !== undefined && { supplier_id: rest.supplier_id }),
      ...(rest.kind !== undefined && { kind: rest.kind }),
      ...(rest.letter !== undefined && { letter: rest.letter ?? null }),
      ...(rest.punto_venta !== undefined && { punto_venta: rest.punto_venta }),
      ...(rest.numero !== undefined && { numero: rest.numero }),
      ...(rest.fecha !== undefined && { fecha: rest.fecha }),
      ...(rest.fch_vto_pago !== undefined && {
        fch_vto_pago: rest.fch_vto_pago ?? null,
      }),
      ...(rest.imp_neto !== undefined && { imp_neto: rest.imp_neto }),
      ...(rest.imp_iva !== undefined && { imp_iva: rest.imp_iva }),
      ...(rest.imp_trib !== undefined && { imp_trib: rest.imp_trib }),
      ...(rest.imp_total !== undefined && { imp_total: rest.imp_total }),
      ...(rest.moneda !== undefined && { moneda: rest.moneda }),
      ...(rest.cotizacion !== undefined && { cotizacion: rest.cotizacion }),
      ...(rest.cae_proveedor !== undefined && {
        cae_proveedor: rest.cae_proveedor ?? null,
      }),
      ...(rest.cae_vto_proveedor !== undefined && {
        cae_vto_proveedor: rest.cae_vto_proveedor ?? null,
      }),
      ...(rest.invoice_origin_id !== undefined && {
        invoice_origin_id: rest.invoice_origin_id ?? null,
      }),
      ...(rest.motivo_nc_nd !== undefined && {
        motivo_nc_nd: rest.motivo_nc_nd ?? null,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes ?? null }),
    })
    .eq("id", id);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Otra factura del proveedor ya usa esa combinación de número.",
      };
    }
    logger.error("purchase_invoices.update.failed", { error });
    return { ok: false, error: "No se pudo actualizar la factura." };
  }

  await logAudit(
    "purchase_invoice.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function cancelPurchaseInvoiceAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:cancel")) {
    return { ok: false, error: "No tenés permiso para anular facturas de compra." };
  }

  const parsed = PurchaseInvoiceCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_invoices")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: ctx.userId,
    })
    .eq("id", parsed.data.id)
    .eq("status", "received");

  if (error) {
    logger.error("purchase_invoices.cancel.failed", { error });
    return { ok: false, error: "No se pudo anular la factura." };
  }

  await logAudit("purchase_invoice.cancelled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
