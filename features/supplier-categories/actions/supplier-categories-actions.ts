"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { escapeLike } from "@/lib/supabase/like-pattern";
import { createClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";
import { UuidSchema } from "@/lib/validation/common";

import {
  isPurchaseInvoiceKind,
  type PurchaseInvoiceKind,
} from "@/features/purchase-invoices/schema";

import {
  SupplierCategoryCreateSchema,
  SupplierCategoryDeleteSchema,
  SupplierCategoryPurchasesInputSchema,
  SupplierCategoryUpdateSchema,
  type SupplierCategory,
} from "../schema";

export async function listSupplierCategoriesAction(
  options: { onlyActive?: boolean } = {},
): Promise<ActionResult<SupplierCategory[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver categorías." };
  }

  const supabase = await createClient();
  const { data, error } = await paginateRange((from, to) => {
    let query = supabase
      .from("supplier_categories")
      .select("id, name, is_active, created_at, updated_at")
      .order("name", { ascending: true });
    if (options.onlyActive) query = query.eq("is_active", true);
    return query.order("id").range(from, to);
  });
  if (error) {
    logger.error("supplier_categories.list.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer las categorías." };
  }

  return { ok: true, data: data ?? [] };
}

export type SupplierCategoryHeader = Pick<
  SupplierCategory,
  "id" | "name" | "is_active"
>;

/** One category for its detail page; `null` when it does not exist. */
export async function getSupplierCategoryAction(
  id: string,
): Promise<ActionResult<SupplierCategoryHeader | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver categorías." };
  }
  if (!UuidSchema.safeParse(id).success) return { ok: true, data: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_categories")
    .select("id, name, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("supplier_categories.get.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo leer la categoría." };
  }
  return { ok: true, data };
}

export interface SupplierCategoryPurchase {
  id: string;
  kind: PurchaseInvoiceKind;
  letter: string | null;
  punto_venta: number;
  numero: number;
  fecha: string;
  imp_total: number;
  moneda: string;
  supplier_id: string;
  supplier_legal_name: string;
  is_fiscal: boolean;
}

export interface SupplierCategoryPurchasesPage {
  purchases: SupplierCategoryPurchase[];
  /** More received purchases in the period than `purchases` holds. */
  hasMore: boolean;
}

/**
 * The latest received purchases of a category's suppliers in a period, on the
 * channel side asked (the rows behind the category's spend figures).
 */
export async function listSupplierCategoryPurchasesAction(
  input: unknown,
): Promise<ActionResult<SupplierCategoryPurchasesPage>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "suppliers:read") ||
    !userCan(ctx.access, "purchase_invoices:read")
  ) {
    return { ok: false, error: "No tenés permiso para ver compras." };
  }
  const parsed = SupplierCategoryPurchasesInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;

  const supabase = await createClient();
  let query = supabase
    .from("purchase_invoices")
    .select(
      "id, kind, letter, punto_venta, numero, fecha, imp_total, moneda, supplier_id, suppliers!inner(legal_name, category_id), invoicing_channels!inner(is_fiscal)",
    )
    .eq("suppliers.category_id", v.categoryId)
    .eq("status", "received")
    .gte("fecha", v.from)
    .lte("fecha", v.to);
  if (v.isFiscal !== null) {
    query = query.eq("invoicing_channels.is_fiscal", v.isFiscal);
  }
  const { data, error } = await query
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(v.limit + 1);
  if (error) {
    logger.error("supplier_categories.purchases.failed", {
      userId: ctx.userId,
      categoryId: v.categoryId,
      error,
    });
    return { ok: false, error: "No se pudieron leer las compras." };
  }

  const purchases: SupplierCategoryPurchase[] = [];
  for (const row of (data ?? []).slice(0, v.limit)) {
    if (!isPurchaseInvoiceKind(row.kind)) continue;
    purchases.push({
      id: row.id,
      kind: row.kind,
      letter: row.letter,
      punto_venta: row.punto_venta,
      numero: row.numero,
      fecha: row.fecha,
      imp_total: row.imp_total,
      moneda: row.moneda,
      supplier_id: row.supplier_id,
      supplier_legal_name: row.suppliers.legal_name,
      is_fiscal: row.invoicing_channels.is_fiscal,
    });
  }
  return {
    ok: true,
    data: { purchases, hasMore: (data ?? []).length > v.limit },
  };
}

const duplicateNameError = (name: string) =>
  `Ya existe la categoría "${name}".`;

/**
 * The existing category whose name equals `name` ignoring case (the unique
 * constraint on name is case-sensitive), other than `exceptId`.
 */
async function findCategoryByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  exceptId?: string,
) {
  let query = supabase
    .from("supplier_categories")
    .select("id, name")
    .ilike("name", escapeLike(name));
  if (exceptId) query = query.neq("id", exceptId);
  return query.limit(1).maybeSingle();
}

/** Whether the user may create categories (the pickers' "Nueva categoría"). */
export async function canCreateSupplierCategoryAction(): Promise<
  ActionResult<boolean>
> {
  const ctx = await requireUserContext();
  return { ok: true, data: userCan(ctx.access, "suppliers:write") };
}

export async function createSupplierCategoryAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para crear categorías." };
  }

  const parsed = SupplierCategoryCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createClient();
  const existing = await findCategoryByName(supabase, parsed.data.name);
  if (existing.error) {
    logger.error("supplier_categories.create.precheck_failed", {
      userId: ctx.userId,
      error: existing.error,
    });
    return { ok: false, error: "No se pudo crear la categoría." };
  }
  if (existing.data) {
    return { ok: false, error: duplicateNameError(existing.data.name) };
  }

  const { data, error } = await supabase
    .from("supplier_categories")
    .insert({
      name: parsed.data.name,
      is_active: parsed.data.is_active,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una categoría con ese nombre.",
      };
    }
    logger.error("supplier_categories.create.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo crear la categoría." };
  }

  await logAudit(
    "supplier_category.created",
    ctx.userId,
    { name: parsed.data.name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateSupplierCategoryAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para editar categorías." };
  }

  const parsed = SupplierCategoryUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  if (rest.name !== undefined) {
    const existing = await findCategoryByName(supabase, rest.name, id);
    if (existing.error) {
      logger.error("supplier_categories.update.precheck_failed", {
        userId: ctx.userId,
        error: existing.error,
      });
      return { ok: false, error: "No se pudo actualizar la categoría." };
    }
    if (existing.data) {
      return { ok: false, error: duplicateNameError(existing.data.name) };
    }
  }
  const { data: changed, error } = await supabase
    .from("supplier_categories")
    .update({
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una categoría con ese nombre.",
      };
    }
    logger.error("supplier_categories.update.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la categoría." };
  }
  if (!changed || changed.length === 0) {
    return { ok: false, error: "No se encontró la categoría." };
  }

  await logAudit("supplier_category.updated", ctx.userId, {}, id);
  return { ok: true, data: undefined };
}

export async function deleteSupplierCategoryAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para borrar categorías." };
  }

  const parsed = SupplierCategoryDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();

  // The count gives the message with how many suppliers use it; the FK
  // (ON DELETE RESTRICT) refuses a supplier assigned after the count.
  const { count, error: countError } = await supabase
    .from("suppliers")
    .select("id", { count: "exact", head: true })
    .eq("category_id", parsed.data.id);

  if (countError) {
    logger.error("supplier_categories.delete.precheck_failed", {
      userId: ctx.userId,
      error: countError,
    });
    return { ok: false, error: "No se pudo verificar uso de la categoría." };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `No se puede borrar: hay ${count} proveedor(es) en esta categoría. Reasignalos primero o desactivá la categoría.`,
    };
  }

  const { data: deleted, error } = await supabase
    .from("supplier_categories")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return {
        ok: false,
        error: "La categoría está en uso, no se puede borrar.",
      };
    }
    logger.error("supplier_categories.delete.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo borrar la categoría." };
  }
  if (!deleted?.length) {
    return { ok: false, error: "La categoría no existe o no se pudo borrar." };
  }

  await logAudit("supplier_category.deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
