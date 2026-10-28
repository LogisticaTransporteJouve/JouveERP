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
  FuelLoadCreateSchema,
  FuelLoadUpdateSchema,
  type FuelLoad,
} from "../schema";

type FuelLoadSelectRow = Pick<
  Database["public"]["Tables"]["fuel_loads"]["Row"],
  | "id"
  | "vehicle_id"
  | "trip_id"
  | "load_date"
  | "liters"
  | "amount"
  | "odometer_km"
  | "station"
  | "card"
  | "notes"
  | "created_at"
> & { vehicle: { patente: string } | null };

function narrowFuelLoad(row: FuelLoadSelectRow): FuelLoad {
  return {
    ...row,
    liters: Number(row.liters),
    amount: Number(row.amount),
    odometer_km: row.odometer_km === null ? null : Number(row.odometer_km),
  };
}

const SELECT_COLUMNS =
  "id, vehicle_id, trip_id, load_date, liters, amount, odometer_km, station, card, notes, created_at, vehicle:vehicles(patente)";

export async function listFuelLoadsAction(): Promise<ActionResult<FuelLoad[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:read")) {
    return {
      ok: false,
      error: "No tenés permiso para ver cargas de combustible.",
    };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("fuel_loads")
      .select(SELECT_COLUMNS)
      .order("load_date", { ascending: false })
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("fuel.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las cargas." };
  }

  const rows = (data ?? []).map((row) => narrowFuelLoad(row));
  return { ok: true, data: rows };
}

export async function createFuelLoadAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:write")) {
    return { ok: false, error: "No tenés permiso para crear cargas." };
  }
  const parsed = FuelLoadCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("fuel_loads")
    .insert({
      vehicle_id: parsed.data.vehicle_id,
      trip_id: parsed.data.trip_id ?? null,
      load_date: parsed.data.load_date,
      liters: parsed.data.liters,
      amount: parsed.data.amount,
      odometer_km: parsed.data.odometer_km ?? null,
      station: parsed.data.station ?? null,
      card: parsed.data.card ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("fuel.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear la carga." };
  }

  await logAudit(
    "fuel_load.created",
    ctx.userId,
    { load_date: parsed.data.load_date },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateFuelLoadAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:write")) {
    return { ok: false, error: "No tenés permiso para editar cargas." };
  }
  const parsed = FuelLoadUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("fuel_loads")
    .update({
      ...(rest.vehicle_id !== undefined && { vehicle_id: rest.vehicle_id }),
      ...(rest.trip_id !== undefined && { trip_id: rest.trip_id }),
      ...(rest.load_date !== undefined && { load_date: rest.load_date }),
      ...(rest.liters !== undefined && { liters: rest.liters }),
      ...(rest.amount !== undefined && { amount: rest.amount }),
      ...(rest.odometer_km !== undefined && { odometer_km: rest.odometer_km }),
      ...(rest.station !== undefined && { station: rest.station }),
      ...(rest.card !== undefined && { card: rest.card }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("fuel.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar la carga." };
  }

  await logAudit(
    "fuel_load.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deleteFuelLoadAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:write")) {
    return { ok: false, error: "No tenés permiso para borrar cargas." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("fuel_loads")
    .delete()
    .eq("id", input.id);
  if (error) {
    logger.error("fuel.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la carga." };
  }
  await logAudit("fuel_load.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
