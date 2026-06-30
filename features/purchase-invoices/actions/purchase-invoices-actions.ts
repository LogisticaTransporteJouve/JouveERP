"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import type { SupplierIdentityJoin } from "@/features/suppliers/schema";

import {
  PurchaseInvoiceCancelSchema,
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceUpdateSchema,
  isPurchaseInvoiceKind,
  isPurchaseInvoiceStatus,
  isPurchaseIvaRateId,
  type PurchaseInvoice,
  type PurchaseInvoiceItem,
  type PurchaseInvoiceItemInput,
  type PurchaseInvoiceLetter,
  type PurchaseIvaRateId,
} from "../schema";

function narrowRow(row: Record<string, unknown>): PurchaseInvoice | null {
  if (!isPurchaseInvoiceKind(row.kind)) return null;
  if (!isPurchaseInvoiceStatus(row.status)) return null;
  return {
    ...(row as PurchaseInvoice),
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
  kind?: string | null;
  excludeId?: string | null;
  isFiscal?: boolean | null;
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
    return {
      ok: false,
      error: "No tenés permiso para ver facturas de compra.",
    };
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
    p_kind: input.kind ?? undefined,
    p_exclude_id: input.excludeId ?? undefined,
    p_is_fiscal: input.isFiscal ?? undefined,
  });

  if (error) {
    logger.error("purchase_invoices.search.failed", {
      userId: ctx.userId,
      query: input.query,
      error,
    });
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
    return {
      ok: false,
      error: "No tenés permiso para ver facturas de compra.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_invoices")
    .select(DETAIL_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("purchase_invoices.get.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo cargar la factura." };
  }
  if (!data) return { ok: true, data: null };

  const supplier = (data as unknown as SupplierIdentityJoin).suppliers;
  const flat = {
    ...data,
    supplier_legal_name: supplier.legal_name,
    supplier_cuit: supplier.cuit,
  } as Record<string, unknown>;
  delete flat.suppliers;

  return { ok: true, data: narrowRow(flat) };
}

export async function getPurchaseInvoiceItemsAction(
  invoiceId: string,
): Promise<ActionResult<PurchaseInvoiceItem[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_invoice_items")
    .select(
      "id, purchase_invoice_id, sort_order, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total, created_at",
    )
    .eq("purchase_invoice_id", invoiceId)
    .order("sort_order", { ascending: true });

  if (error) {
    logger.error("purchase_invoices.items.list.failed", {
      userId: ctx.userId,
      invoiceId,
      error,
    });
    return { ok: false, error: "No se pudieron leer los ítems." };
  }

  const items: PurchaseInvoiceItem[] = (data ?? []).map((row) => ({
    id: row.id,
    purchase_invoice_id: row.purchase_invoice_id,
    sort_order: row.sort_order,
    description: row.description,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    iva_rate_id: isPurchaseIvaRateId(row.iva_rate_id)
      ? (row.iva_rate_id as PurchaseIvaRateId)
      : null,
    line_neto: Number(row.line_neto),
    line_iva: Number(row.line_iva),
    line_total: Number(row.line_total),
    created_at: row.created_at,
  }));

  return { ok: true, data: items };
}

export type PurchaseInvoiceAllocation = {
  payment_order_id: string;
  payment_order_numero: number;
  payment_order_punto_venta: number;
  payment_order_date: string;
  payment_order_status: string;
  amount_applied: number;
};

export async function getPurchaseInvoiceAllocationsAction(
  invoiceId: string,
): Promise<ActionResult<PurchaseInvoiceAllocation[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_order_allocations")
    .select(
      "amount_applied, payment_orders!inner(id, numero, punto_venta, payment_date, status)",
    )
    .eq("purchase_invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("purchase_invoices.allocations.failed", {
      userId: ctx.userId,
      invoiceId,
      error,
    });
    return { ok: false, error: "No se pudieron leer las imputaciones." };
  }

  type AllocationJoinedRow = {
    payment_orders: {
      id: string;
      numero: number;
      punto_venta: number;
      payment_date: string;
      status: string;
    };
  };

  const out: PurchaseInvoiceAllocation[] = (data ?? []).map((row) => {
    const op = (row as unknown as AllocationJoinedRow).payment_orders;
    return {
      payment_order_id: op.id,
      payment_order_numero: op.numero,
      payment_order_punto_venta: op.punto_venta,
      payment_order_date: op.payment_date,
      payment_order_status: op.status,
      amount_applied: Number(row.amount_applied),
    };
  });

  return { ok: true, data: out };
}

export async function createPurchaseInvoiceAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:write")) {
    return {
      ok: false,
      error: "No tenés permiso para cargar facturas de compra.",
    };
  }

  const parsed = PurchaseInvoiceCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_invoices")
    .insert({
      channel_id: parsed.data.channel_id,
      account_id: parsed.data.account_id ?? null,
      cost_center_id: parsed.data.cost_center_id ?? null,
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
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error:
          "Ya cargaste esta factura del proveedor (mismo tipo / letra / PV / número).",
      };
    }
    logger.error("purchase_invoices.create.failed", {
      userId: ctx.userId,
      supplier_id: parsed.data.supplier_id,
      numero: parsed.data.numero,
      error,
    });
    return { ok: false, error: "No se pudo cargar la factura." };
  }

  // If the invoice carries items, insert them + recompute header totals via
  // RPC. If the RPC fails, we leave the header without items (better than an
  // orphan): the header totals are already valid because they came from the input.
  if (parsed.data.items && parsed.data.items.length > 0) {
    const itemsError = await applyItems(supabase, data.id, parsed.data.items);
    if (itemsError) {
      logger.error("purchase_invoices.items.insert.failed", {
        userId: ctx.userId,
        id: data.id,
        error: itemsError,
      });
      return {
        ok: false,
        error: "Factura cargada pero no se pudieron guardar los ítems.",
      };
    }
  }

  await logAudit(
    "purchase_invoice.created",
    ctx.userId,
    {
      supplier_id: parsed.data.supplier_id,
      kind: parsed.data.kind,
      numero: parsed.data.numero,
      imp_total: parsed.data.imp_total,
      items_count: parsed.data.items?.length ?? 0,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

async function applyItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
  items: PurchaseInvoiceItemInput[],
): Promise<string | null> {
  const { error } = await supabase.rpc("replace_purchase_invoice_items", {
    p_invoice_id: invoiceId,
    p_items: items.map((it, idx) => ({
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      iva_rate_id: it.iva_rate_id,
      line_neto: it.line_neto,
      line_iva: it.line_iva,
      line_total: it.line_total,
      sort_order: it.sort_order ?? idx,
    })),
  });
  return error ? error.message : null;
}

export async function updatePurchaseInvoiceAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:write")) {
    return {
      ok: false,
      error: "No tenés permiso para editar facturas de compra.",
    };
  }

  const parsed = PurchaseInvoiceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
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
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Otra factura del proveedor ya usa esa combinación de número.",
      };
    }
    logger.error("purchase_invoices.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la factura." };
  }

  // Items are optional on update. If the caller passes an array (even an
  // empty one), we replace them. If it passes undefined, we don't touch the items.
  if (rest.items !== undefined) {
    const itemsError = await applyItems(supabase, id, rest.items);
    if (itemsError) {
      logger.error("purchase_invoices.items.update.failed", {
        userId: ctx.userId,
        id,
        error: itemsError,
      });
      return {
        ok: false,
        error: "Factura actualizada pero no se pudieron guardar los ítems.",
      };
    }
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
    return {
      ok: false,
      error: "No tenés permiso para anular facturas de compra.",
    };
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
    logger.error("purchase_invoices.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo anular la factura." };
  }

  await logAudit("purchase_invoice.cancelled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
