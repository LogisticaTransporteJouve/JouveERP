"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  DriverCreateSchema,
  DriverLinkUserSchema,
  DriverToggleSchema,
  DriverUpdateSchema,
  type Driver,
} from "../schema";

const SELECT_COLUMNS =
  "id, employee_id, user_id, full_name, cuit, license_number, license_category, phone, is_active, notes, created_at, updated_at";

export async function listDriversAction(
  input: { onlyActive?: boolean } = {},
): Promise<ActionResult<Driver[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "drivers:read")) {
    return { ok: false, error: "No tenés permiso para ver choferes." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) => {
    let query = supabase
      .from("drivers")
      .select(SELECT_COLUMNS)
      .order("is_active", { ascending: false })
      .order("full_name");
    if (input.onlyActive) query = query.eq("is_active", true);
    return query.order("id").range(from, to);
  });
  if (error) {
    logger.error("drivers.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los choferes." };
  }
  return { ok: true, data: data ?? [] };
}

export async function createDriverAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "drivers:write")) {
    return { ok: false, error: "No tenés permiso para crear choferes." };
  }
  const parsed = DriverCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("drivers")
    .insert({
      full_name: parsed.data.full_name,
      employee_id: parsed.data.employee_id ?? null,
      cuit: parsed.data.cuit ?? null,
      license_number: parsed.data.license_number ?? null,
      license_category: parsed.data.license_category ?? null,
      phone: parsed.data.phone ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("drivers.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el chofer." };
  }

  await logAudit(
    "driver.created",
    ctx.userId,
    { full_name: parsed.data.full_name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateDriverAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "drivers:write")) {
    return { ok: false, error: "No tenés permiso para editar choferes." };
  }
  const parsed = DriverUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("drivers")
    .update({
      ...(rest.full_name !== undefined && { full_name: rest.full_name }),
      ...(rest.employee_id !== undefined && { employee_id: rest.employee_id }),
      ...(rest.cuit !== undefined && { cuit: rest.cuit }),
      ...(rest.license_number !== undefined && {
        license_number: rest.license_number,
      }),
      ...(rest.license_category !== undefined && {
        license_category: rest.license_category,
      }),
      ...(rest.phone !== undefined && { phone: rest.phone }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("drivers.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el chofer." };
  }

  await logAudit(
    "driver.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function setDriverActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "drivers:write")) {
    return { ok: false, error: "No tenés permiso para editar choferes." };
  }
  const parsed = DriverToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("drivers")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("drivers.toggle.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  await logAudit(
    parsed.data.is_active ? "driver.reactivated" : "driver.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteDriverAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "drivers:write")) {
    return { ok: false, error: "No tenés permiso para borrar choferes." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("drivers").delete().eq("id", input.id);
  if (error) {
    logger.error("drivers.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el chofer." };
  }
  await logAudit("driver.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}

/**
 * Links (or unlinks, userId=null) a driver to an app user so RLS can scope that
 * user to their own trips (Fase G.3). Granting a login is a security action →
 * gated on users:assign_role (admins), not the operations drivers:write.
 */
export async function linkDriverUserAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "users:assign_role")) {
    return { ok: false, error: "No tenés permiso para vincular usuarios." };
  }
  const parsed = DriverLinkUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("drivers")
    .update({ user_id: parsed.data.userId })
    .eq("id", parsed.data.driverId);
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ese usuario ya está vinculado a otro chofer.",
      };
    }
    logger.error("drivers.link_user.failed", {
      userId: ctx.userId,
      driverId: parsed.data.driverId,
      error,
    });
    return { ok: false, error: "No se pudo vincular el usuario." };
  }

  await logAudit(
    parsed.data.userId ? "driver.user_linked" : "driver.user_unlinked",
    ctx.userId,
    { linked_user_id: parsed.data.userId },
    parsed.data.driverId,
  );
  return { ok: true, data: undefined };
}
