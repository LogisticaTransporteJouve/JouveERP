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
  WarehouseCreateSchema,
  WarehouseToggleSchema,
  WarehouseUpdateSchema,
  type Warehouse,
} from "../schema";

type WarehouseSelectRow = Pick<
  Database["public"]["Tables"]["warehouses"]["Row"],
  | "id"
  | "name"
  | "address"
  | "capacity_pallets"
  | "is_active"
  | "notes"
  | "created_at"
  | "updated_at"
>;

function narrowWarehouse(row: WarehouseSelectRow): Warehouse {
  return {
    ...row,
    capacity_pallets:
      row.capacity_pallets === null ? null : Number(row.capacity_pallets),
  };
}

const SELECT_COLUMNS =
  "id, name, address, capacity_pallets, is_active, notes, created_at, updated_at";

export async function listWarehousesAction(
  input: { onlyActive?: boolean } = {},
): Promise<ActionResult<Warehouse[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "warehouses:read")) {
    return { ok: false, error: "No tenés permiso para ver depósitos." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) => {
    let query = supabase
      .from("warehouses")
      .select(SELECT_COLUMNS)
      .order("is_active", { ascending: false })
      .order("name");
    if (input.onlyActive) query = query.eq("is_active", true);
    return query.order("id").range(from, to);
  });
  if (error) {
    logger.error("warehouses.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los depósitos." };
  }

  const warehouses = (data ?? []).map((row) => narrowWarehouse(row));

  return { ok: true, data: warehouses };
}

export async function createWarehouseAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "warehouses:write")) {
    return { ok: false, error: "No tenés permiso para crear depósitos." };
  }
  const parsed = WarehouseCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("warehouses")
    .insert({
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      capacity_pallets: parsed.data.capacity_pallets ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("warehouses.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el depósito." };
  }

  await logAudit(
    "warehouse.created",
    ctx.userId,
    { name: parsed.data.name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateWarehouseAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "warehouses:write")) {
    return { ok: false, error: "No tenés permiso para editar depósitos." };
  }
  const parsed = WarehouseUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("warehouses")
    .update({
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.address !== undefined && { address: rest.address }),
      ...(rest.capacity_pallets !== undefined && {
        capacity_pallets: rest.capacity_pallets,
      }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("warehouses.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el depósito." };
  }

  await logAudit(
    "warehouse.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function setWarehouseActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "warehouses:write")) {
    return { ok: false, error: "No tenés permiso para editar depósitos." };
  }
  const parsed = WarehouseToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("warehouses")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("warehouses.toggle.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  await logAudit(
    parsed.data.is_active ? "warehouse.reactivated" : "warehouse.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteWarehouseAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "warehouses:write")) {
    return { ok: false, error: "No tenés permiso para borrar depósitos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("warehouses")
    .delete()
    .eq("id", input.id);
  if (error) {
    logger.error("warehouses.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el depósito." };
  }
  await logAudit("warehouse.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
