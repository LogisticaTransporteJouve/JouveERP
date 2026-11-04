"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import type { PartialCreateFailure } from "@/lib/actions/claim";
import { ivaIsComputable } from "@/lib/afip/codes";
import type { JsonValue } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import type { SupplierIdentityJoin } from "@/features/suppliers/schema";

import {
  EXEMPT_ITEMS_MESSAGE,
  PURCHASE_INVOICE_KINDS,
  PURCHASE_TOTAL_MISMATCH_MESSAGE,
  PURCHASE_TOTAL_PART_FIELDS,
  PurchaseInvoiceCancelSchema,
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceUpdateSchema,
  isPurchaseInvoiceKind,
  itemsDoubleCountExempt,
  isPurchaseInvoiceLetter,
  isPurchaseInvoiceStatus,
  isPurchaseIvaRateId,
  purchaseTotalGap,
  type PurchaseInvoice,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceItem,
  type PurchaseInvoiceItemInput,
  type PurchaseInvoiceLetter,
  type PurchaseIvaRateId,
  type PurchaseTotalParts,
} from "../schema";

const EMPLOYEE_CHARGE_DENIED =
  "No tenés permiso para cargar una compra a un empleado.";

const NON_COMPUTABLE_DENIED =
  "En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto: cargá el IVA en 0 y, si hay ítems, con «Sin alícuota».";

type LetterAmounts = {
  channel_id: string;
  letter: string | null;
  imp_iva: number;
  imp_no_gravado: number;
  imp_op_exentas: number;
};

/** A fiscal B or C purchase books IVA, exento and no gravado inside the net
 *  (citi.ts declares IVA only for A). An old fiscal purchase without letter
 *  is left as it is. */
async function carriesNonComputableAmounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  v: LetterAmounts,
): Promise<boolean | { failed: unknown }> {
  if (v.letter === null || ivaIsComputable(v.letter)) return false;
  if (v.imp_iva + v.imp_no_gravado + v.imp_op_exentas === 0) return false;
  const { data, error } = await supabase
    .from("invoicing_channels")
    .select("is_fiscal")
    .eq("id", v.channel_id)
    .maybeSingle();
  if (error) return { failed: error };
  return data?.is_fiscal === true;
}

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
  if (!userCan(ctx.access, "purchase_invoices:read")) {
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
  "id, channel_id, account_id, cost_center_id, charged_employee_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, imp_neto, imp_iva, imp_trib, imp_total, imp_no_gravado, imp_op_exentas, imp_perc_iva, imp_perc_iibb, imp_perc_municipales, imp_impuestos_internos, moneda, cotizacion, cae_proveedor, cae_vto_proveedor, status, invoice_origin_id, motivo_nc_nd, notes, created_by, cancelled_at, cancelled_by, created_at, updated_at, suppliers!inner(legal_name, cuit)";

export async function getPurchaseInvoiceByIdAction(
  id: string,
): Promise<ActionResult<PurchaseInvoice | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:read")) {
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
  const {
    imp_no_gravado,
    imp_op_exentas,
    imp_perc_iva,
    imp_perc_iibb,
    imp_perc_municipales,
    imp_impuestos_internos,
    ...header
  } = data;
  const flat = {
    ...header,
    supplier_legal_name: supplier.legal_name,
    supplier_cuit: supplier.cuit,
    amount_breakdown: {
      imp_no_gravado,
      imp_op_exentas,
      imp_perc_iva,
      imp_perc_iibb,
      imp_perc_municipales,
      imp_impuestos_internos,
    },
  } as Record<string, unknown>;
  delete flat.suppliers;

  return { ok: true, data: narrowRow(flat) };
}

export async function getPurchaseInvoiceItemsAction(
  invoiceId: string,
): Promise<ActionResult<PurchaseInvoiceItem[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:read")) {
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
  if (!userCan(ctx.access, "purchase_invoices:read")) {
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

const DuplicateLookupSchema = z.object({
  supplier_id: z.string().uuid(),
  kind: z.enum(PURCHASE_INVOICE_KINDS),
  punto_venta: z.number().int().min(1),
  numero: z.number().int().min(1),
});

export type PurchaseInvoiceDuplicate = {
  id: string;
  kind: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number;
  numero: number;
  status: string;
};

/**
 * An already-loaded purchase invoice of the same supplier with the same type,
 * punto de venta and número (any letter, any status), or null.
 */
export async function findPurchaseInvoiceDuplicateAction(
  input: unknown,
): Promise<ActionResult<PurchaseInvoiceDuplicate | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:read")) {
    return {
      ok: false,
      error: "No tenés permiso para ver facturas de compra.",
    };
  }
  const parsed = DuplicateLookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_invoices")
    .select("id, kind, letter, punto_venta, numero, status")
    .eq("supplier_id", parsed.data.supplier_id)
    .eq("kind", parsed.data.kind)
    .eq("punto_venta", parsed.data.punto_venta)
    .eq("numero", parsed.data.numero)
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error("purchase_invoices.duplicate_lookup.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo verificar si la factura existe." };
  }
  if (!data || !isPurchaseInvoiceKind(data.kind))
    return { ok: true, data: null };
  return {
    ok: true,
    data: {
      id: data.id,
      kind: data.kind,
      letter: isPurchaseInvoiceLetter(data.letter) ? data.letter : null,
      punto_venta: data.punto_venta,
      numero: data.numero,
      status: data.status,
    },
  };
}

export async function createPurchaseInvoiceAction(
  input: unknown,
): Promise<ActionResult<{ id: string }> | PartialCreateFailure> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
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
  if (parsed.data.charged_employee_id && !userCan(ctx.access, "hr:write")) {
    return { ok: false, error: EMPLOYEE_CHARGE_DENIED };
  }

  const supabase = await createClient();

  const nonComputable = await carriesNonComputableAmounts(supabase, {
    channel_id: parsed.data.channel_id,
    letter: parsed.data.letter ?? null,
    imp_iva: parsed.data.imp_iva,
    imp_no_gravado: parsed.data.imp_no_gravado,
    imp_op_exentas: parsed.data.imp_op_exentas,
  });
  if (typeof nonComputable === "object") {
    logger.error("purchase_invoices.create.channel_failed", {
      userId: ctx.userId,
      error: nonComputable.failed,
    });
    return { ok: false, error: "No se pudo cargar la factura." };
  }
  if (nonComputable) return { ok: false, error: NON_COMPUTABLE_DENIED };

  // An expense account (picked, a supplier default or AI-suggested) must be a
  // postable leaf: guard_expense_account rejects any other with a message.
  const { data, error } = await supabase
    .from("purchase_invoices")
    .insert({
      channel_id: parsed.data.channel_id,
      account_id: parsed.data.account_id ?? null,
      cost_center_id: parsed.data.cost_center_id ?? null,
      charged_employee_id: parsed.data.charged_employee_id ?? null,
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
      imp_no_gravado: parsed.data.imp_no_gravado,
      imp_op_exentas: parsed.data.imp_op_exentas,
      imp_perc_iva: parsed.data.imp_perc_iva,
      imp_perc_iibb: parsed.data.imp_perc_iibb,
      imp_perc_municipales: parsed.data.imp_perc_municipales,
      imp_impuestos_internos: parsed.data.imp_impuestos_internos,
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
    const guardError = mapDbGuardError(error, {
      slug: "purchase_invoices.create.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
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
      const guardError = mapDbGuardError(itemsError, {
        slug: "purchase_invoices.items.insert.rejected",
        userId: ctx.userId,
        id: data.id,
      });
      if (guardError)
        return { ok: false, error: guardError, createdId: data.id };
      logger.error("purchase_invoices.items.insert.failed", {
        userId: ctx.userId,
        id: data.id,
        error: itemsError,
      });
      return {
        ok: false,
        error: "Factura cargada pero no se pudieron guardar los ítems.",
        createdId: data.id,
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
      account_id: parsed.data.account_id ?? null,
      cost_center_id: parsed.data.cost_center_id ?? null,
      charged_employee_id: parsed.data.charged_employee_id ?? null,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

async function applyItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
  items: PurchaseInvoiceItemInput[],
): Promise<PostgrestError | null> {
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
  return error;
}

export async function updatePurchaseInvoiceAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
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
  if (
    rest.charged_employee_id !== undefined &&
    !userCan(ctx.access, "hr:write")
  ) {
    return { ok: false, error: EMPLOYEE_CHARGE_DENIED };
  }
  const supabase = await createClient();

  // The letter rule applies to what this edit changes, so an old B purchase
  // with IVA stays editable. Items are checked against the stored exento too:
  // replace_purchase_invoice_items refuses them only after the header is saved.
  // The total rule applies to an edit that changes an amount, so an old
  // purchase whose total and parts differ still saves its other fields.
  const sendsAmounts = PURCHASE_TOTAL_PART_FIELDS.some(
    (f) => rest[f] !== undefined,
  );
  if (
    sendsAmounts ||
    rest.channel_id !== undefined ||
    rest.letter !== undefined ||
    rest.items?.some((item) => item.iva_rate_id === null)
  ) {
    const { data: stored, error: storedError } = await supabase
      .from("purchase_invoices")
      .select(
        "channel_id, letter, imp_neto, imp_iva, imp_trib, imp_no_gravado, imp_op_exentas, imp_total",
      )
      .eq("id", id)
      .maybeSingle();
    if (storedError) {
      logger.error("purchase_invoices.update.read_failed", {
        userId: ctx.userId,
        id,
        error: storedError,
      });
      return { ok: false, error: "No se pudo actualizar la factura." };
    }
    if (!stored) return { ok: false, error: "La factura no existe." };
    const next: LetterAmounts = {
      channel_id: rest.channel_id ?? stored.channel_id,
      letter: rest.letter !== undefined ? (rest.letter ?? null) : stored.letter,
      imp_iva: rest.imp_iva ?? stored.imp_iva,
      imp_no_gravado: rest.imp_no_gravado ?? stored.imp_no_gravado,
      imp_op_exentas: rest.imp_op_exentas ?? stored.imp_op_exentas,
    };
    if (itemsDoubleCountExempt({ ...next, items: rest.items })) {
      return { ok: false, error: EXEMPT_ITEMS_MESSAGE };
    }
    const amounts: PurchaseTotalParts = {
      imp_neto: rest.imp_neto ?? stored.imp_neto,
      imp_iva: next.imp_iva,
      imp_trib: rest.imp_trib ?? stored.imp_trib,
      imp_no_gravado: next.imp_no_gravado,
      imp_op_exentas: next.imp_op_exentas,
      imp_total: rest.imp_total ?? stored.imp_total,
    };
    if (
      PURCHASE_TOTAL_PART_FIELDS.some((f) => amounts[f] !== stored[f]) &&
      purchaseTotalGap(amounts) !== null
    ) {
      return { ok: false, error: PURCHASE_TOTAL_MISMATCH_MESSAGE };
    }
    const changed =
      next.letter !== stored.letter ||
      next.imp_iva !== stored.imp_iva ||
      next.imp_no_gravado !== stored.imp_no_gravado ||
      next.imp_op_exentas !== stored.imp_op_exentas ||
      next.channel_id !== stored.channel_id;
    if (changed) {
      const nonComputable = await carriesNonComputableAmounts(supabase, next);
      if (typeof nonComputable === "object") {
        logger.error("purchase_invoices.update.channel_failed", {
          userId: ctx.userId,
          id,
          error: nonComputable.failed,
        });
        return { ok: false, error: "No se pudo actualizar la factura." };
      }
      if (nonComputable) return { ok: false, error: NON_COMPUTABLE_DENIED };
    }
  }

  const { error } = await supabase
    .from("purchase_invoices")
    .update({
      ...(rest.channel_id !== undefined && { channel_id: rest.channel_id }),
      ...(rest.account_id !== undefined && {
        account_id: rest.account_id ?? null,
      }),
      ...(rest.cost_center_id !== undefined && {
        cost_center_id: rest.cost_center_id ?? null,
      }),
      ...(rest.charged_employee_id !== undefined && {
        charged_employee_id: rest.charged_employee_id ?? null,
      }),
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
      ...(rest.imp_no_gravado !== undefined && {
        imp_no_gravado: rest.imp_no_gravado,
      }),
      ...(rest.imp_op_exentas !== undefined && {
        imp_op_exentas: rest.imp_op_exentas,
      }),
      ...(rest.imp_perc_iva !== undefined && {
        imp_perc_iva: rest.imp_perc_iva,
      }),
      ...(rest.imp_perc_iibb !== undefined && {
        imp_perc_iibb: rest.imp_perc_iibb,
      }),
      ...(rest.imp_perc_municipales !== undefined && {
        imp_perc_municipales: rest.imp_perc_municipales,
      }),
      ...(rest.imp_impuestos_internos !== undefined && {
        imp_impuestos_internos: rest.imp_impuestos_internos,
      }),
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
    const guardError = mapDbGuardError(error, {
      slug: "purchase_invoices.update.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
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
      const guardError = mapDbGuardError(itemsError, {
        slug: "purchase_invoices.items.update.rejected",
        userId: ctx.userId,
        id,
      });
      if (guardError) return { ok: false, error: guardError };
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
  if (!userCan(ctx.access, "purchase_invoices:cancel")) {
    return {
      ok: false,
      error: "No tenés permiso para anular facturas de compra.",
    };
  }

  const parsed = PurchaseInvoiceCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();
  const { data: cancelled, error } = await supabase
    .from("purchase_invoices")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: ctx.userId,
    })
    .eq("id", parsed.data.id)
    .eq("status", "received")
    .select("id");

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "purchase_invoices.cancel.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("purchase_invoices.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo anular la factura." };
  }
  if (!cancelled || cancelled.length === 0) {
    return {
      ok: false,
      error:
        "La factura ya estaba anulada o no se encontró. Recargá la página.",
    };
  }

  await logAudit("purchase_invoice.cancelled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

const NextInternalNumeroSchema = z.object({
  channelId: z.string().min(1),
  supplierId: z.string().uuid(),
  kind: z.enum(PURCHASE_INVOICE_KINDS),
  puntoVenta: z.number().int().min(1).max(99999).default(1),
});

/**
 * The next número of an internal (non-fiscal) purchase for the supplier, kind
 * and punto de venta. Fiscal purchases carry the supplier's own número.
 */
export async function nextInternalPurchaseNumeroAction(
  input: unknown,
): Promise<ActionResult<number>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return {
      ok: false,
      error: "No tenés permiso para cargar facturas de compra.",
    };
  }
  const parsed = NextInternalNumeroSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = getServiceClient();
  const { data: channel, error: channelError } = await supabase
    .from("invoicing_channels")
    .select("is_fiscal")
    .eq("id", parsed.data.channelId)
    .maybeSingle();
  if (channelError) {
    logger.error("purchase_invoices.next_numero.channel_failed", {
      userId: ctx.userId,
      error: channelError,
    });
    return { ok: false, error: "No se pudo calcular el próximo número." };
  }
  if (!channel) return { ok: false, error: "El canal elegido no existe." };
  if (channel.is_fiscal) {
    return {
      ok: false,
      error: "Las compras fiscales llevan el número del comprobante.",
    };
  }

  const { data, error } = await supabase.rpc("next_internal_purchase_numero", {
    p_supplier_id: parsed.data.supplierId,
    p_kind: parsed.data.kind,
    p_punto_venta: parsed.data.puntoVenta,
  });
  if (error || typeof data !== "number") {
    logger.error("purchase_invoices.next_numero.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo calcular el próximo número." };
  }
  return { ok: true, data };
}
