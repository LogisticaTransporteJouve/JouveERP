"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  TripCreateSchema,
  TripUpdateSchema,
  isTripStatus,
  type Trip,
} from "../schema";

const SELECT_COLUMNS =
  "id, trip_date, driver_id, vehicle_id, channel_id, origin, destination, cargo_description, status, km, revenue, cost, notes, created_at, updated_at, driver:drivers(full_name), vehicle:vehicles(patente)";

function narrow(row: {
  status: string;
  km: number | null;
  revenue: number | null;
  cost: number | null;
  [key: string]: unknown;
}): Trip | null {
  if (!isTripStatus(row.status)) {
    logger.error("trips.unknown_enum", { status: row.status });
    return null;
  }
  return {
    ...row,
    km: row.km === null ? null : Number(row.km),
    revenue: row.revenue === null ? null : Number(row.revenue),
    cost: row.cost === null ? null : Number(row.cost),
  } as Trip;
}

export async function listTripsAction(): Promise<ActionResult<Trip[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "trips:read")) {
    return { ok: false, error: "No tenés permiso para ver viajes." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("trips")
    .select(SELECT_COLUMNS)
    .order("trip_date", { ascending: false });
  if (error) {
    logger.error("trips.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los viajes." };
  }

  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is Trip => row !== null);
  return { ok: true, data: rows };
}

export async function createTripAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "trips:write")) {
    return { ok: false, error: "No tenés permiso para crear viajes." };
  }
  const parsed = TripCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("trips")
    .insert({
      trip_date: parsed.data.trip_date,
      driver_id: parsed.data.driver_id ?? null,
      vehicle_id: parsed.data.vehicle_id ?? null,
      channel_id: parsed.data.channel_id ?? null,
      origin: parsed.data.origin ?? null,
      destination: parsed.data.destination ?? null,
      cargo_description: parsed.data.cargo_description ?? null,
      status: parsed.data.status,
      km: parsed.data.km ?? null,
      revenue: parsed.data.revenue ?? null,
      cost: parsed.data.cost ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("trips.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el viaje." };
  }

  await logAudit(
    "trip.created",
    ctx.userId,
    { trip_date: parsed.data.trip_date },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateTripAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "trips:write")) {
    return { ok: false, error: "No tenés permiso para editar viajes." };
  }
  const parsed = TripUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("trips")
    .update({
      ...(rest.trip_date !== undefined && { trip_date: rest.trip_date }),
      ...(rest.driver_id !== undefined && { driver_id: rest.driver_id }),
      ...(rest.vehicle_id !== undefined && { vehicle_id: rest.vehicle_id }),
      ...(rest.channel_id !== undefined && { channel_id: rest.channel_id }),
      ...(rest.origin !== undefined && { origin: rest.origin }),
      ...(rest.destination !== undefined && { destination: rest.destination }),
      ...(rest.cargo_description !== undefined && {
        cargo_description: rest.cargo_description,
      }),
      ...(rest.status !== undefined && { status: rest.status }),
      ...(rest.km !== undefined && { km: rest.km }),
      ...(rest.revenue !== undefined && { revenue: rest.revenue }),
      ...(rest.cost !== undefined && { cost: rest.cost }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("trips.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el viaje." };
  }

  await logAudit(
    "trip.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deleteTripAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "trips:write")) {
    return { ok: false, error: "No tenés permiso para borrar viajes." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("trips").delete().eq("id", input.id);
  if (error) {
    logger.error("trips.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el viaje." };
  }
  await logAudit("trip.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
