"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { costVoucherDenied, costVoucherPatch } from "@/lib/cost-vouchers";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { drainOrFirst } from "@/lib/supabase/paginate";

import {
  FuelLoadCreateSchema,
  FuelLoadListFilterSchema,
  FuelLoadUpdateSchema,
  type FuelLoadListFilter,
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
  | "purchase_invoice_id"
  | "transaction_id"
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

const IdSchema = z.object({ id: z.string().uuid() });

const SELECT_COLUMNS =
  "id, vehicle_id, trip_id, load_date, liters, amount, odometer_km, station, card, notes, purchase_invoice_id, transaction_id, created_at, vehicle:vehicles(patente)";

/** Every load, newest first; `filter` narrows it (the page passes none). */
export async function listFuelLoadsAction(
  filter?: FuelLoadListFilter,
): Promise<ActionResult<FuelLoad[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:read")) {
    return {
      ok: false,
      error: "No tenés permiso para ver cargas de combustible.",
    };
  }
  const parsed = FuelLoadListFilterSchema.safeParse(filter ?? {});
  if (!parsed.success) return { ok: false, error: "Filtros inválidos." };
  const f = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await drainOrFirst((from, to) => {
    let query = supabase.from("fuel_loads").select(SELECT_COLUMNS);
    if (f.from) query = query.gte("load_date", f.from);
    if (f.to) query = query.lte("load_date", f.to);
    if (f.vehicleId) query = query.eq("vehicle_id", f.vehicleId);
    if (f.tripId) query = query.eq("trip_id", f.tripId);
    return query
      .order("load_date", { ascending: false })
      .order("id")
      .range(from, to);
  }, f.limit);
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
  const voucherDenied = costVoucherDenied(ctx.access, parsed.data);
  if (voucherDenied) return { ok: false, error: voucherDenied };

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
      ...costVoucherPatch(parsed.data),
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

/** No row matched: deleted meanwhile, or hidden by RLS. */
const FUEL_LOAD_NOT_FOUND = "No se encontró la carga. Actualizá la página.";

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
  const voucherDenied = costVoucherDenied(ctx.access, parsed.data);
  if (voucherDenied) return { ok: false, error: voucherDenied };
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: changed, error } = await supabase
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
      ...costVoucherPatch(rest),
    })
    .eq("id", id)
    .select("id");
  if (error) {
    logger.error("fuel.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar la carga." };
  }
  if ((changed ?? []).length === 0) {
    return { ok: false, error: FUEL_LOAD_NOT_FOUND };
  }

  await logAudit(
    "fuel_load.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deleteFuelLoadAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:write")) {
    return { ok: false, error: "No tenés permiso para borrar cargas." };
  }
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Carga inválida." };
  const { id } = parsed.data;
  const supabase = await createSupabaseClient();
  const { data: changed, error } = await supabase
    .from("fuel_loads")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    logger.error("fuel.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la carga." };
  }
  if ((changed ?? []).length === 0) {
    return { ok: false, error: FUEL_LOAD_NOT_FOUND };
  }
  await logAudit("fuel_load.deleted", ctx.userId, {}, id);
  return { ok: true, data: undefined };
}
