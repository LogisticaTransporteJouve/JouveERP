"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  VehicleCreateSchema,
  VehicleToggleSchema,
  VehicleUpdateSchema,
  isVehicleType,
  type Vehicle,
} from "../schema";

type VehicleSelectRow = Pick<
  Database["public"]["Tables"]["vehicles"]["Row"],
  | "id"
  | "patente"
  | "alias"
  | "vehicle_type"
  | "brand"
  | "model"
  | "year"
  | "fleet"
  | "capacity_kg"
  | "is_active"
  | "notes"
  | "created_at"
  | "updated_at"
>;

function narrowVehicle(row: VehicleSelectRow): Vehicle | null {
  if (!isVehicleType(row.vehicle_type)) {
    logger.error("vehicles.unknown_type", { value: row.vehicle_type });
    return null;
  }
  return {
    ...row,
    vehicle_type: row.vehicle_type,
    capacity_kg: row.capacity_kg === null ? null : Number(row.capacity_kg),
  };
}

const SELECT_COLUMNS =
  "id, patente, alias, vehicle_type, brand, model, year, fleet, capacity_kg, is_active, notes, created_at, updated_at";

export async function listVehiclesAction(
  input: { onlyActive?: boolean } = {},
): Promise<ActionResult<Vehicle[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "vehicles:read")) {
    return { ok: false, error: "No tenés permiso para ver vehículos." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) => {
    let query = supabase
      .from("vehicles")
      .select(SELECT_COLUMNS)
      .order("is_active", { ascending: false })
      .order("patente");
    if (input.onlyActive) query = query.eq("is_active", true);
    return query.order("id").range(from, to);
  });
  if (error) {
    logger.error("vehicles.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los vehículos." };
  }

  const vehicles = (data ?? [])
    .map((row) => narrowVehicle(row))
    .filter((row): row is Vehicle => row !== null);

  return { ok: true, data: vehicles };
}

export async function createVehicleAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "vehicles:write")) {
    return { ok: false, error: "No tenés permiso para crear vehículos." };
  }
  const parsed = VehicleCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      patente: parsed.data.patente,
      vehicle_type: parsed.data.vehicle_type,
      alias: parsed.data.alias ?? null,
      brand: parsed.data.brand ?? null,
      model: parsed.data.model ?? null,
      year: parsed.data.year ?? null,
      fleet: parsed.data.fleet ?? null,
      capacity_kg: parsed.data.capacity_kg ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe un vehículo con esa patente.",
      };
    }
    logger.error("vehicles.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el vehículo." };
  }

  await logAudit(
    "vehicle.created",
    ctx.userId,
    { patente: parsed.data.patente },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateVehicleAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "vehicles:write")) {
    return { ok: false, error: "No tenés permiso para editar vehículos." };
  }
  const parsed = VehicleUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("vehicles")
    .update({
      ...(rest.patente !== undefined && { patente: rest.patente }),
      ...(rest.vehicle_type !== undefined && {
        vehicle_type: rest.vehicle_type,
      }),
      ...(rest.alias !== undefined && { alias: rest.alias }),
      ...(rest.brand !== undefined && { brand: rest.brand }),
      ...(rest.model !== undefined && { model: rest.model }),
      ...(rest.year !== undefined && { year: rest.year }),
      ...(rest.fleet !== undefined && { fleet: rest.fleet }),
      ...(rest.capacity_kg !== undefined && { capacity_kg: rest.capacity_kg }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe un vehículo con esa patente.",
      };
    }
    logger.error("vehicles.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el vehículo." };
  }

  await logAudit(
    "vehicle.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function setVehicleActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "vehicles:write")) {
    return { ok: false, error: "No tenés permiso para editar vehículos." };
  }
  const parsed = VehicleToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("vehicles")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("vehicles.toggle.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  await logAudit(
    parsed.data.is_active ? "vehicle.reactivated" : "vehicle.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteVehicleAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "vehicles:write")) {
    return { ok: false, error: "No tenés permiso para borrar vehículos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("vehicles").delete().eq("id", input.id);
  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return {
        ok: false,
        error:
          "El vehículo tiene cargas de combustible, mantenimientos, documentos o viajes. Desactivalo en lugar de borrarlo.",
      };
    }
    logger.error("vehicles.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el vehículo." };
  }
  await logAudit("vehicle.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
