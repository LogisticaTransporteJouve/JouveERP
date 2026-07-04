"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import { isIvaCondition } from "@/features/clients/schema";

import {
  SupplierCreateSchema,
  SupplierToggleActiveSchema,
  SupplierUpdateSchema,
  type Supplier,
} from "../schema";

function narrowSupplier(row: {
  iva_condition: string;
  [key: string]: unknown;
}): Supplier | null {
  if (!isIvaCondition(row.iva_condition)) {
    logger.error("suppliers.unknown_iva_condition", {
      value: row.iva_condition,
    });
    return null;
  }
  return row as Supplier;
}

const SELECT_COLS =
  "id, cuit, legal_name, display_name, iva_condition, email, phone, address, real_address, notes, is_active, created_by, created_at, updated_at";

export async function listSuppliersAction(): Promise<ActionResult<Supplier[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver proveedores." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select(SELECT_COLS)
    .order("legal_name");

  if (error) {
    logger.error("suppliers.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo listar los proveedores." };
  }

  const items = (data ?? [])
    .map((row) => narrowSupplier(row))
    .filter((row): row is Supplier => row !== null);

  return { ok: true, data: items };
}

export type SearchSuppliersInput = {
  query?: string;
  onlyActive?: boolean;
  offset?: number;
  limit?: number;
  categoryId?: string | null;
};

export type SearchSuppliersPage = {
  suppliers: Supplier[];
  nextOffset: number | null;
};

export async function searchSuppliersAction(
  input: SearchSuppliersInput = {},
): Promise<ActionResult<SearchSuppliersPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver proveedores." };
  }

  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("search_suppliers", {
    p_query: (input.query ?? "").trim(),
    p_only_active: input.onlyActive ?? true,
    p_offset: offset,
    p_limit: limit + 1,
    p_category_id: input.categoryId ?? undefined,
  });

  if (error) {
    logger.error("suppliers.search.failed", {
      userId: ctx.userId,
      query: input.query,
      error,
    });
    return { ok: false, error: "No se pudo buscar proveedores." };
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const suppliers = rows
    .slice(0, limit)
    .map((row) => narrowSupplier(row))
    .filter((row): row is Supplier => row !== null);

  return {
    ok: true,
    data: { suppliers, nextOffset: hasMore ? offset + limit : null },
  };
}

export async function getSupplierByIdAction(
  id: string,
): Promise<ActionResult<Supplier | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver proveedores." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("suppliers.get.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo cargar el proveedor." };
  }

  return { ok: true, data: data ? narrowSupplier(data) : null };
}

export async function findSupplierByCuitAction(
  cuit: string,
): Promise<ActionResult<Supplier | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver proveedores." };
  }

  const cuitClean = cuit.replace(/[^0-9]/g, "");
  if (!/^[0-9]{11}$/.test(cuitClean)) {
    return { ok: true, data: null };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select(SELECT_COLS)
    .eq("cuit", cuitClean)
    .maybeSingle();

  if (error) {
    logger.error("suppliers.find_by_cuit.failed", {
      userId: ctx.userId,
      cuit: cuitClean,
      error,
    });
    return { ok: false, error: "No se pudo buscar el proveedor por CUIT." };
  }

  return { ok: true, data: data ? narrowSupplier(data) : null };
}

export async function createSupplierAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para crear proveedores." };
  }

  const parsed = SupplierCreateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      cuit: parsed.data.cuit,
      legal_name: parsed.data.legal_name,
      display_name: parsed.data.display_name ?? null,
      iva_condition: parsed.data.iva_condition,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      real_address: parsed.data.real_address ?? null,
      notes: parsed.data.notes ?? null,
      default_channel_id: parsed.data.default_channel_id ?? null,
      default_payment_term_days: parsed.data.default_payment_term_days ?? null,
      category_id: parsed.data.category_id ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya existe un proveedor con ese CUIT." };
    }
    logger.error("suppliers.create.failed", {
      userId: ctx.userId,
      cuit: parsed.data.cuit,
      error,
    });
    return { ok: false, error: "No se pudo crear el proveedor." };
  }

  await logAudit(
    "supplier.created",
    ctx.userId,
    { cuit: parsed.data.cuit, legal_name: parsed.data.legal_name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateSupplierAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para editar proveedores." };
  }

  const parsed = SupplierUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("suppliers")
    .update({
      ...(rest.cuit !== undefined && { cuit: rest.cuit }),
      ...(rest.legal_name !== undefined && { legal_name: rest.legal_name }),
      ...(rest.display_name !== undefined && {
        display_name: rest.display_name ?? null,
      }),
      ...(rest.iva_condition !== undefined && {
        iva_condition: rest.iva_condition,
      }),
      ...(rest.email !== undefined && { email: rest.email ?? null }),
      ...(rest.phone !== undefined && { phone: rest.phone ?? null }),
      ...(rest.address !== undefined && { address: rest.address ?? null }),
      ...(rest.real_address !== undefined && {
        real_address: rest.real_address ?? null,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes ?? null }),
      ...(rest.default_channel_id !== undefined && {
        default_channel_id: rest.default_channel_id ?? null,
      }),
      ...(rest.default_payment_term_days !== undefined && {
        default_payment_term_days: rest.default_payment_term_days ?? null,
      }),
      ...(rest.category_id !== undefined && {
        category_id: rest.category_id ?? null,
      }),
    })
    .eq("id", id);

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya existe un proveedor con ese CUIT." };
    }
    logger.error("suppliers.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el proveedor." };
  }

  await logAudit(
    "supplier.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export type SupplierReferences = {
  total: number;
  details: Record<string, number>;
};

// Same as in clients: once purchase_invoices / payment_orders arrive
// they get added to the array and the dialog already routes through here.
export async function getSupplierReferencesAction(
  id: string,
): Promise<ActionResult<SupplierReferences>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver proveedores." };
  }

  // Every table that references suppliers. RESTRICT rows would block the delete
  // at the DB anyway (surface a clear message instead of a raw FK error);
  // CASCADE rows (opening balances, allocations, attachments) would be silently
  // wiped, so they must be counted here to protect financial history.
  const dependents: Array<{ table: string; column: string }> = [
    { table: "purchase_invoices", column: "supplier_id" },
    { table: "payment_orders", column: "supplier_id" },
    { table: "issued_checks", column: "supplier_id" },
    { table: "supplier_opening_balances", column: "supplier_id" },
    { table: "supplier_opening_balance_allocations", column: "supplier_id" },
    { table: "file_attachments", column: "supplier_id" },
    { table: "transactions", column: "counterparty_supplier_id" },
  ];

  const supabase = await createSupabaseClient();
  const details: Record<string, number> = {};
  let total = 0;

  for (const dep of dependents) {
    const { count, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(dep.table as any)
      .select("*", { count: "exact", head: true })
      .eq(dep.column, id);
    if (error) {
      logger.warn("suppliers.refs.count_failed", {
        userId: ctx.userId,
        id,
        table: dep.table,
        err: error.message,
      });
      continue;
    }
    if (count && count > 0) {
      details[dep.table] = count;
      total += count;
    }
  }

  return { ok: true, data: { total, details } };
}

export async function deleteSupplierAction(id: string): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para eliminar proveedores." };
  }

  const refs = await getSupplierReferencesAction(id);
  if (!refs.ok) return refs;
  if (refs.data.total > 0) {
    return {
      ok: false,
      error:
        "El proveedor tiene movimientos asociados. Desactivalo en lugar de eliminarlo.",
    };
  }

  // RLS blocks DELETE; we use service-role after validating permissions and refs.
  const service = getServiceClient();
  const { error } = await service.from("suppliers").delete().eq("id", id);

  if (error) {
    logger.error("suppliers.delete.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo eliminar el proveedor." };
  }

  await logAudit("supplier.deleted", ctx.userId, {}, id);
  return { ok: true, data: undefined };
}

export async function setSupplierActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:write")) {
    return { ok: false, error: "No tenés permiso para editar proveedores." };
  }

  const parsed = SupplierToggleActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);

  if (error) {
    logger.error("suppliers.toggle_active.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      is_active: parsed.data.is_active,
      error,
    });
    return { ok: false, error: "No se pudo cambiar el estado del proveedor." };
  }

  await logAudit(
    parsed.data.is_active ? "supplier.reactivated" : "supplier.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}
