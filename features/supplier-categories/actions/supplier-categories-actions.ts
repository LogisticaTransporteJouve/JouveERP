"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  SupplierCategoryCreateSchema,
  SupplierCategoryDeleteSchema,
  SupplierCategoryUpdateSchema,
  type SupplierCategory,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };


export async function listSupplierCategoriesAction(
  options: { onlyActive?: boolean } = {},
): Promise<ActionResult<SupplierCategory[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver categorías." };
  }

  const supabase = await createClient();
  const query = supabase
    .from("supplier_categories")
    .select("id, name, slug, is_active, created_at, updated_at")
    .order("name", { ascending: true });

  if (options.onlyActive) {
    query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) {
    logger.error("supplier_categories.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer las categorías." };
  }

  return { ok: true, data: data ?? [] };
}

export async function createSupplierCategoryAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:write")) {
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
  const { data, error } = await supabase
    .from("supplier_categories")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      is_active: parsed.data.is_active,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una categoría con ese nombre o slug.",
      };
    }
    logger.error("supplier_categories.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear la categoría." };
  }

  return { ok: true, data: { id: data.id } };
}

export async function updateSupplierCategoryAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:write")) {
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
  const { error } = await supabase
    .from("supplier_categories")
    .update({
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.slug !== undefined && { slug: rest.slug }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
    })
    .eq("id", id);

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una categoría con ese nombre o slug.",
      };
    }
    logger.error("supplier_categories.update.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo actualizar la categoría." };
  }

  return { ok: true, data: undefined };
}

export async function deleteSupplierCategoryAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para borrar categorías." };
  }

  const parsed = SupplierCategoryDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();

  // Pre-check: ¿hay proveedores asignados? Si sí, bloqueamos con mensaje
  // claro. La FK tiene ON DELETE SET NULL, así que el delete no rompería
  // referencias pero perderíamos la categoría del supplier silenciosamente.
  const { count, error: countError } = await supabase
    .from("suppliers")
    .select("id", { count: "exact", head: true })
    .eq("category_id", parsed.data.id);

  if (countError) {
    logger.error("supplier_categories.delete.precheck_failed", { userId: ctx.userId, error: countError });
    return { ok: false, error: "No se pudo verificar uso de la categoría." };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `No se puede borrar: hay ${count} proveedor(es) en esta categoría. Reasignalos primero o desactivá la categoría.`,
    };
  }

  const { error } = await supabase
    .from("supplier_categories")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return { ok: false, error: "La categoría está en uso, no se puede borrar." };
    }
    logger.error("supplier_categories.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la categoría." };
  }

  return { ok: true, data: undefined };
}
