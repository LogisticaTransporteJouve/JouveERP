"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  ProductCreateSchema,
  ProductToggleSchema,
  ProductUpdateSchema,
  type Product,
} from "../schema";

type ProductSelectRow = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  | "id"
  | "client_id"
  | "name"
  | "sku"
  | "unit"
  | "is_active"
  | "notes"
  | "created_at"
  | "updated_at"
> & { client: { legal_name: string } | null };

function toProduct(row: ProductSelectRow): Product {
  return { ...row };
}

const SELECT_COLUMNS =
  "id, client_id, name, sku, unit, is_active, notes, created_at, updated_at, client:clients(legal_name)";

export async function listProductsAction(): Promise<ActionResult<Product[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "products:read")) {
    return { ok: false, error: "No tenés permiso para ver productos." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("products")
      .select(SELECT_COLUMNS)
      .order("name")
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("products.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los productos." };
  }

  const rows = (data ?? []).map((row) => toProduct(row));
  return { ok: true, data: rows };
}

export async function createProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "products:write")) {
    return { ok: false, error: "No tenés permiso para crear productos." };
  }
  const parsed = ProductCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      client_id: parsed.data.client_id,
      name: parsed.data.name,
      sku: parsed.data.sku ?? null,
      unit: parsed.data.unit ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("products.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el producto." };
  }

  await logAudit(
    "product.created",
    ctx.userId,
    { name: parsed.data.name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateProductAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "products:write")) {
    return { ok: false, error: "No tenés permiso para editar productos." };
  }
  const parsed = ProductUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("products")
    .update({
      ...(rest.client_id !== undefined && { client_id: rest.client_id }),
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.sku !== undefined && { sku: rest.sku }),
      ...(rest.unit !== undefined && { unit: rest.unit }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("products.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el producto." };
  }

  await logAudit(
    "product.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function setProductActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "products:write")) {
    return { ok: false, error: "No tenés permiso para editar productos." };
  }
  const parsed = ProductToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("products")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("products.toggle.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  await logAudit(
    parsed.data.is_active ? "product.reactivated" : "product.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteProductAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "products:write")) {
    return { ok: false, error: "No tenés permiso para borrar productos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("products").delete().eq("id", input.id);
  if (error) {
    logger.error("products.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el producto." };
  }
  await logAudit("product.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
