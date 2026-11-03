"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  StorageAreaCreateSchema,
  StorageAreaUpdateSchema,
  type StorageArea,
  type StorageAreaCreateInput,
  type StorageAreaUpdateInput,
} from "../schema";

const SELECT_COLUMNS =
  "id, warehouse_id, name, is_active, notes, warehouse:warehouses(name)";
const WRITE_DENIED = "No tenés permiso para editar áreas de depósito.";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

/**
 * Areas of every warehouse (or one), for the warehouse page and the pickers
 * of the pallet dialog and the client tariff. Read through the service client
 * after the gate: finance prices areas (storage_billing:read) but the areas
 * RLS, like the warehouses one, leaves it out.
 */
export async function listStorageAreasAction(
  input: { warehouseId?: string; onlyActive?: boolean } = {},
): Promise<ActionResult<StorageArea[]>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "warehouses:read") &&
    !userCan(ctx.access, "pallets:read") &&
    !userCan(ctx.access, "storage_billing:read")
  ) {
    return { ok: false, error: "No tenés permiso para ver áreas de depósito." };
  }
  const warehouseId = input.warehouseId
    ? z.string().uuid().safeParse(input.warehouseId)
    : null;
  if (warehouseId && !warehouseId.success) {
    return { ok: false, error: "Depósito inválido." };
  }

  const supabase = getServiceClient();
  const { data, error } = await paginateRange((from, to) => {
    let q = supabase.from("storage_areas").select(SELECT_COLUMNS);
    if (warehouseId?.success) q = q.eq("warehouse_id", warehouseId.data);
    if (input.onlyActive) q = q.eq("is_active", true);
    return q.order("name").order("id").range(from, to);
  });
  if (error) {
    logger.error("storage_areas.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las áreas." };
  }
  return {
    ok: true,
    data: (data ?? []).map(({ warehouse, ...a }) => ({
      ...a,
      warehouse_name: warehouse?.name ?? "—",
    })),
  };
}

export async function createStorageAreaAction(
  input: StorageAreaCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "warehouses:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = StorageAreaCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const { data, error } = await getServiceClient()
    .from("storage_areas")
    .insert({
      warehouse_id: parsed.data.warehouse_id,
      name: parsed.data.name,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya hay un área con ese nombre." };
    }
    logger.error("storage_areas.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el área." };
  }

  await logAudit(
    "storage_area.created",
    ctx.userId,
    { warehouse_id: parsed.data.warehouse_id, name: parsed.data.name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateStorageAreaAction(
  input: StorageAreaUpdateInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "warehouses:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = StorageAreaUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, ...rest } = parsed.data;

  const { data, error } = await getServiceClient()
    .from("storage_areas")
    .update({
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya hay un área con ese nombre." };
    }
    logger.error("storage_areas.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar el área." };
  }
  if (data.length === 0) return { ok: false, error: "No se encontró el área." };

  await logAudit(
    "storage_area.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deleteStorageAreaAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "warehouses:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Área inválida." };

  const { data, error } = await getServiceClient()
    .from("storage_areas")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error) {
    // Pallets or client tariffs still point to it (ON DELETE RESTRICT).
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return {
        ok: false,
        error:
          "El área tiene pallets o tarifas: desactivala en lugar de borrarla.",
      };
    }
    logger.error("storage_areas.delete.failed", {
      userId: ctx.userId,
      id: id.data,
      error,
    });
    return { ok: false, error: "No se pudo borrar el área." };
  }
  if (data.length === 0) return { ok: false, error: "No se encontró el área." };

  await logAudit("storage_area.deleted", ctx.userId, {}, id.data);
  return { ok: true, data: undefined };
}
